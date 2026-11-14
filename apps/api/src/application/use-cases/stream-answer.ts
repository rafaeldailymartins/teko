import {
  createStreamErrorChunk,
  StoredQuestionStatus,
  type TekoStreamChunk,
} from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import type { Clock } from '../ports/clock.ts'
import type {
  ClaimedQuestion,
  QuestionRepository,
  StreamResult,
  UsageReservation,
} from '../ports/question-repository.ts'
import { PROMPT_VERSION } from '../prompts/answer.ts'
import type { Lifecycle } from '../services/lifecycle.ts'
import { shadowCostUsd } from '../services/pricing.ts'
import type { StreamBudget } from '../services/stream-budget.ts'
import {
  type AnswerOutcome,
  type AnswerPipelineDeps,
  runAnswerPipeline,
} from './answer-pipeline.ts'

/**
 * `StreamAnswer` (`POST /api/v1/questions/:id/stream`): claim atômico `pending → streaming` (zero
 * linhas → 409 `stream_busy`), depois o pipeline da resposta com teto próprio de
 * `min(100 s, prazo − agora − 20 s)` e o sinal da desconexão. Antes do `finish`, uma transação curta
 * grava a resposta, acerta a reserva de `stream_seconds` pelo uso real e guarda o cache.
 *
 * - teto estourado → `error` `upstream_unavailable` (retryable), pergunta `failed`;
 * - cadeia de LLM fora do ar → `error` com o código dela, pergunta `failed`;
 * - desconexão → o LLM é abortado pelo sinal e `aborted` é gravado em `BackgroundTasks`; a cota
 *   consumida não volta.
 */
interface StreamAnswerCommand {
  readonly user: SessionUser
  readonly questionId: string
  /** Aborta quando o cliente desconecta. */
  readonly signal: AbortSignal
  /** Início da invocação (para o prazo da plataforma). */
  readonly startedAtMs: number
  readonly traceId: string
}

export type StreamAnswer = (command: StreamAnswerCommand) => Promise<AsyncIterable<TekoStreamChunk>>

export interface StreamAnswerDeps {
  readonly questions: QuestionRepository
  readonly pipeline: AnswerPipelineDeps
  readonly clock: Clock
  readonly streamBudget: StreamBudget
  readonly lifecycle: Pick<Lifecycle, 'isDraining'>
  readonly backgroundTasks: BackgroundTasks
  readonly reservation: UsageReservation
  readonly cacheTtlMs: number
}

/** Teto do stream estourado (o sinal do timer aborta com isto). */
export class StreamTimeoutError extends Error {
  constructor() {
    super('stream timeout')
    this.name = 'StreamTimeoutError'
  }
}

/** Teto para gravar `aborted` depois da desconexão (tarefa pós-resposta). */
const ABORT_RECORD_TIMEOUT_MS = 2000
const NO_MODEL = 'none'

interface Timing {
  readonly startedMs: number
  readonly endedMs: number
}

function baseResult(timing: Timing): Omit<StreamResult, 'status'> {
  return {
    answerMarkdown: null,
    citations: [],
    meta: null,
    refusal: null,
    retrievalMode: null,
    provider: null,
    model: null,
    promptVersion: PROMPT_VERSION,
    corpusVersion: null,
    inputTokens: 0,
    outputTokens: 0,
    shadowCostUsd: 0,
    ttftMs: null,
    latencyMs: timing.endedMs - timing.startedMs,
    streamSeconds: Math.max(1, Math.ceil((timing.endedMs - timing.startedMs) / 1000)),
    cache: null,
  }
}

export function resultOf(
  question: ClaimedQuestion,
  outcome: AnswerOutcome,
  timing: Timing,
  cacheTtlMs: number,
): StreamResult {
  const answered = outcome.answer !== null
  return {
    ...baseResult(timing),
    status: answered ? StoredQuestionStatus.Answered : StoredQuestionStatus.Refused,
    answerMarkdown: outcome.answer?.markdown ?? null,
    citations: outcome.answer?.citations ?? [],
    meta: outcome.answer?.meta ?? null,
    refusal: outcome.refusal,
    retrievalMode: outcome.retrievalMode,
    provider: outcome.provider,
    model: outcome.model,
    corpusVersion: outcome.answer?.meta.corpusVersion ?? question.corpusVersion,
    inputTokens: outcome.usage.inputTokens,
    outputTokens: outcome.usage.outputTokens,
    shadowCostUsd: shadowCostUsd(outcome.model, outcome.usage),
    ttftMs: outcome.firstTokenAtMs === null ? null : outcome.firstTokenAtMs - timing.startedMs,
    cache:
      outcome.answer !== null && question.cacheKey !== null
        ? {
            key: question.cacheKey,
            answer: outcome.answer,
            expiresAt: new Date(timing.endedMs + cacheTtlMs),
          }
        : null,
  }
}

function errorCodeOf(error: unknown, timedOut: boolean): ErrorCode {
  if (timedOut) {
    return ErrorCode.UpstreamUnavailable
  }
  if (error instanceof ApplicationError) {
    return error.problem.code
  }
  return ErrorCode.Internal
}

export function createStreamAnswer(deps: StreamAnswerDeps): StreamAnswer {
  const nowMs = (): number => deps.clock.now().getTime()

  async function* run(
    command: StreamAnswerCommand,
    question: ClaimedQuestion,
  ): AsyncGenerator<TekoStreamChunk> {
    const startedMs = nowMs()
    const timer = new AbortController()
    const handle = setTimeout(
      () => timer.abort(new StreamTimeoutError()),
      deps.streamBudget.timeoutMs(command.startedAtMs, startedMs),
    )
    const signal = AbortSignal.any([command.signal, timer.signal])
    let outcome: AnswerOutcome | null = null
    let recorded = false
    try {
      yield* runAnswerPipeline(
        deps.pipeline,
        {
          messageId: question.id,
          question: question.questionRedacted,
          referenceInput: question.referenceInput,
          referenceSource: question.referenceSource,
          families: question.families,
          locale: question.locale,
          zeroDataRetention: question.zeroDataRetention,
          signal,
        },
        (value) => {
          outcome = value
        },
      )
      // O pipeline sempre entrega o resultado antes de terminar sem exceção.
      const done = outcome as unknown as AnswerOutcome
      await deps.questions.finish(
        question.id,
        deps.reservation,
        resultOf(question, done, { startedMs, endedMs: nowMs() }, deps.cacheTtlMs),
      )
      recorded = true
      yield {
        type: 'finish',
        messageMetadata: {
          usage: { ...done.usage },
          model: done.model ?? NO_MODEL,
          traceId: command.traceId,
        },
      }
    } catch (error) {
      if (command.signal.aborted && !timer.signal.aborted) {
        // O cliente saiu: ninguém lê o `error`; o `finally` grava `aborted`.
        return
      }
      await deps.questions.finish(question.id, deps.reservation, {
        ...baseResult({ startedMs, endedMs: nowMs() }),
        status: StoredQuestionStatus.Failed,
      })
      recorded = true
      yield createStreamErrorChunk(errorCodeOf(error, timer.signal.aborted))
    } finally {
      clearTimeout(handle)
      if (!recorded) {
        deps.backgroundTasks.run(
          'question-aborted',
          deps.questions.finish(question.id, deps.reservation, {
            ...baseResult({ startedMs, endedMs: nowMs() }),
            status: StoredQuestionStatus.Aborted,
          }),
          { timeoutMs: ABORT_RECORD_TIMEOUT_MS },
        )
      }
    }
  }

  return async (command) => {
    if (deps.lifecycle.isDraining()) {
      throw new ApplicationError({ code: ErrorCode.ServicePaused })
    }
    const claim = await deps.questions.claim(command.questionId, command.user.id)
    if (claim.kind === 'not_found') {
      throw new ApplicationError({ code: ErrorCode.NotFound, detail: 'Question not found' })
    }
    if (claim.kind === 'busy') {
      throw new ApplicationError({ code: ErrorCode.StreamBusy })
    }
    return run(command, claim.question)
  }
}
