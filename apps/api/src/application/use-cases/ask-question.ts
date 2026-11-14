import {
  type AskQuestionRequest,
  type AskQuestionResponse,
  QuestionStatus,
  RefusalReason,
} from '@teko/shared/contracts'
import { ErrorCode, type QuotaScope } from '@teko/shared/errors'
import { DISPLAY_TIME_ZONE } from '@teko/shared/i18n'
import { redact } from '@teko/shared/pii'
import { isoDateInTimeZone } from '@teko/shared/vigencia'
import { cacheKeyMaterial } from '#domain/qa/cache-key.ts'
import { requiresZeroRetention } from '#domain/qa/regional-policy.ts'
import { nextMidnightMs } from '#domain/shared/time-zone.ts'
import { CoverageStatus } from '#domain/vigencia/coverage-decision.ts'
import { ResolutionKind } from '#domain/vigencia/reference-resolution.ts'
import { ApplicationError } from '../errors.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { Clock } from '../ports/clock.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import type {
  NewQuestion,
  QuestionRepository,
  StoredReferenceInput,
  UsageCaps,
  UsageReservation,
} from '../ports/question-repository.ts'
import { PROMPT_VERSION } from '../prompts/answer.ts'
import type { Lifecycle } from '../services/lifecycle.ts'
import type { ProviderRouter } from '../services/provider-router.ts'
import { decideQuota } from '../services/quota-guard.ts'
import { toResolved } from './answer-pipeline.ts'
import type { CheckCoverage, CoverageSource } from './check-coverage.ts'
import type { ResolveReferenceDate } from './resolve-reference-date.ts'

/**
 * `AskQuestion` (`POST /api/v1/questions`), em transações curtas:
 *
 * 1. drenagem (SIGTERM fora da Vercel) → 503; pergunta redigida (PII) antes de qualquer uso;
 * 2. data de referência: conflito → `needs_clarification` (nada gravado);
 * 3. cobertura: data fora → `refused/out_of_coverage`, gravada, sem LLM e sem cota;
 * 4. cache exato → `answered` com `meta.cached`, sem cota;
 * 5. kill switch → 503 `service_paused`; nenhum modelo para a região → 451 ou 503;
 * 6. `QuotaGuard` sob advisory lock do usuário, com a reserva de `stream_seconds`, e a pergunta
 *    `pending` → `accepted{questionId}` para o stream.
 */
interface AskQuestionCommand {
  readonly user: SessionUser
  readonly request: AskQuestionRequest
  readonly requestId: string
  /** País da requisição informado pela plataforma (geolocalização da Vercel), ou `null`. */
  readonly requestCountry: string | null
}

export type AskQuestion = (command: AskQuestionCommand) => Promise<AskQuestionResponse>

export interface AskQuestionDeps {
  readonly questions: QuestionRepository
  readonly resolveReferenceDate: ResolveReferenceDate
  readonly checkCoverage: CheckCoverage
  readonly coverage: CoverageSource
  readonly router: ProviderRouter
  readonly hasher: ContentHasher
  readonly clock: Clock
  readonly lifecycle: Pick<Lifecycle, 'isDraining'>
  readonly caps: UsageCaps
  readonly reservation: UsageReservation
  readonly killSwitch: boolean
}

/** Dia das cotas (São Paulo) e o instante em que elas voltam. */
export function quotaDay(clock: Clock): { readonly day: string; readonly resetAt: string } {
  const now = clock.now()
  return {
    day: isoDateInTimeZone(now, DISPLAY_TIME_ZONE),
    resetAt: new Date(nextMidnightMs(now.getTime(), DISPLAY_TIME_ZONE)).toISOString(),
  }
}

export function quotaExceeded(scope: QuotaScope, resetAt: string): ApplicationError {
  return new ApplicationError({ code: ErrorCode.QuotaExceeded, meta: { scope, resetAt } })
}

export function createAskQuestion(deps: AskQuestionDeps): AskQuestion {
  return async ({ user, request, requestId, requestCountry }) => {
    if (deps.lifecycle.isDraining()) {
      throw new ApplicationError({ code: ErrorCode.ServicePaused })
    }
    const question = redact(request.question).text
    const referenceInput: StoredReferenceInput =
      request.periodoApuracao === undefined
        ? { referenceDate: request.referenceDate ?? '' }
        : { periodoApuracao: request.periodoApuracao }
    const resolution = deps.resolveReferenceDate({
      input: referenceInput,
      source: request.source,
      questionText: question,
    })
    if (resolution.kind === ResolutionKind.NeedsClarification) {
      return {
        status: QuestionStatus.NeedsClarification,
        reason: resolution.reason,
        candidates: [...resolution.candidates],
      }
    }
    const { reference } = resolution
    const families = request.families ?? []
    const zeroDataRetention = requiresZeroRetention(user.countryOfResidence, requestCountry)
    const decision = await deps.checkCoverage(reference.value, families)
    const { corpusVersion } = await deps.coverage()
    const base: NewQuestion = {
      userId: user.id,
      conversationId: request.conversationId,
      questionRedacted: question,
      locale: request.locale,
      families,
      referenceDate: reference.value,
      referenceSource: reference.source,
      referenceInput,
      requestId,
      zeroDataRetention,
      cacheKey: null,
      corpusVersion,
    }
    const resolved = toResolved(reference)

    if (decision.status === CoverageStatus.OutOfCoverage) {
      const refusal = { reason: RefusalReason.OutOfCoverage, coverage: [...decision.coverage] }
      const questionId = await deps.questions.insertFinished({
        ...base,
        status: 'refused',
        answer: null,
        refusal,
      })
      return { status: QuestionStatus.Refused, questionId, resolved, refusal }
    }

    const cacheKey = deps.hasher.hash(
      cacheKeyMaterial({
        question,
        referenceDate: reference.value,
        corpusVersion,
        promptVersion: PROMPT_VERSION,
        modelFamily: zeroDataRetention ? 'zdr' : 'default',
        locale: request.locale,
        families,
      }),
    )
    const cached = await deps.questions.cachedAnswer(cacheKey, deps.clock.now())
    if (cached !== null) {
      const answer = { ...cached, meta: { ...cached.meta, cached: true } }
      const questionId = await deps.questions.insertFinished({
        ...base,
        cacheKey,
        status: 'answered',
        answer,
        refusal: null,
      })
      return { status: QuestionStatus.Answered, questionId, resolved, answer }
    }

    if (deps.killSwitch) {
      throw new ApplicationError({ code: ErrorCode.ServicePaused })
    }
    if (zeroDataRetention && !deps.router.hasZeroRetentionModel()) {
      throw new ApplicationError({ code: ErrorCode.RegionRestricted })
    }
    if (deps.router.available({ zeroDataRetentionOnly: zeroDataRetention }).length === 0) {
      throw new ApplicationError({ code: ErrorCode.UpstreamUnavailable })
    }

    const { day, resetAt } = quotaDay(deps.clock)
    const outcome = await deps.questions.accept(
      { ...base, cacheKey },
      day,
      deps.reservation,
      (usage) => decideQuota(usage, deps.caps, deps.reservation),
    )
    if (outcome.kind === 'busy') {
      throw new ApplicationError({ code: ErrorCode.StreamBusy })
    }
    if (outcome.kind === 'quota') {
      throw quotaExceeded(outcome.scope, resetAt)
    }
    return { status: QuestionStatus.Accepted, questionId: outcome.questionId, resolved }
  }
}
