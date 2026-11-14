import {
  type ClarificationReason,
  type FamilyCoverage,
  RefusalReason,
  type RetrievalMode,
} from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import type { Evidence } from '#domain/qa/evidence.ts'
import { maxRrf } from '#domain/qa/evidence.ts'
import { CoverageStatus } from '#domain/vigencia/coverage-decision.ts'
import {
  markPeriodBoundary,
  ResolutionKind,
  type ResolvedReference,
} from '#domain/vigencia/reference-resolution.ts'
import type { CheckCoverage } from './check-coverage.ts'
import type { FindPeriodVersions } from './find-period-versions.ts'
import type { HybridSearch, HybridSearchResult } from './hybrid-search.ts'
import type { ResolveReferenceDate, ResolveReferenceDateCommand } from './resolve-reference-date.ts'

/**
 * Tudo o que acontece antes do LLM: data de referência → cobertura → busca híbrida. É o núcleo do
 * `AskQuestion` (F4), da rota de eval `GET /api/v1/_eval/search` e das retrieval evals (que o
 * chamam in-process). Recusa sem LLM em três casos: data fora da cobertura, retrieval vazio e
 * `max(rrf) < MIN_EVIDENCE_RRF`.
 */
interface RetrieveEvidenceCommand extends ResolveReferenceDateCommand {
  /** Pergunta já redigida (também é o texto em que se procuram datas). */
  readonly questionText: string
  /** Famílias pedidas; vazio = todas. */
  readonly families: readonly string[]
  /** Usuário do EEE, Reino Unido ou Suíça: a reescrita da pergunta só usa modelos com ZDR. */
  readonly zeroDataRetentionOnly?: boolean
  readonly signal?: AbortSignal
}

export const RetrievalOutcome = {
  Evidence: 'evidence',
  Refused: 'refused',
  NeedsClarification: 'needs_clarification',
} as const

type RetrievalResult =
  | {
      readonly outcome: typeof RetrievalOutcome.NeedsClarification
      readonly reason: ClarificationReason
      readonly candidates: readonly IsoDate[]
    }
  | {
      readonly outcome: typeof RetrievalOutcome.Refused
      readonly reason: typeof RefusalReason.OutOfCoverage | typeof RefusalReason.NoEvidence
      readonly reference: ResolvedReference
      readonly coverage: readonly FamilyCoverage[]
      readonly mode: RetrievalMode | null
    }
  | {
      readonly outcome: typeof RetrievalOutcome.Evidence
      readonly reference: ResolvedReference
      readonly mode: RetrievalMode
      readonly evidence: readonly Evidence[]
      readonly uncoveredFamilies: readonly string[]
      readonly stableKeys: readonly string[]
      /** Consulta reescrita pelo LLM que a busca usou; `null` sem reescrita (ADR 0034). */
      readonly rewrittenQuery: string | null
    }

export type RetrieveEvidence = (command: RetrieveEvidenceCommand) => Promise<RetrievalResult>

export interface RetrieveEvidenceDeps {
  readonly resolveReferenceDate: ResolveReferenceDate
  readonly checkCoverage: CheckCoverage
  readonly hybridSearch: HybridSearch
  /** Vigências com fronteira dentro do PA nas unidades das evidências (aviso de fronteira). */
  readonly findPeriodVersions: FindPeriodVersions
  /** Abaixo disso (maior RRF da lista) a pergunta é recusada como `no_evidence`. */
  readonly minEvidenceRrf: number
}

/**
 * Aviso de fronteira dentro do PA: primeiro pelas vigências das próprias evidências (o fim delas
 * dentro do mês); se nada aparecer, pelas vigências que cruzam o mês nas unidades das evidências e
 * das chaves citadas, onde aparece o que começa depois do dia 1 (consulta só nesse caso).
 */
async function referenceWithBoundary(
  deps: RetrieveEvidenceDeps,
  reference: ResolvedReference,
  families: readonly string[],
  search: HybridSearchResult,
): Promise<ResolvedReference> {
  const marked = markPeriodBoundary(
    reference,
    search.evidence.map((item) => item.validity),
  )
  if (marked.periodo === null || marked.periodBoundaryInside) {
    return marked
  }
  const versions = await deps.findPeriodVersions({
    periodo: marked.periodo,
    families,
    stableKeys: [...search.evidence.map((item) => item.stableKey), ...search.stableKeys],
  })
  return markPeriodBoundary(marked, versions)
}

export function createRetrieveEvidence(deps: RetrieveEvidenceDeps): RetrieveEvidence {
  return async (command) => {
    const resolution = deps.resolveReferenceDate(command)
    if (resolution.kind === ResolutionKind.NeedsClarification) {
      return {
        outcome: RetrievalOutcome.NeedsClarification,
        reason: resolution.reason,
        candidates: resolution.candidates,
      }
    }
    const date = resolution.reference.value
    const decision = await deps.checkCoverage(date, command.families)
    if (decision.status === CoverageStatus.OutOfCoverage) {
      return {
        outcome: RetrievalOutcome.Refused,
        reason: RefusalReason.OutOfCoverage,
        reference: resolution.reference,
        coverage: decision.coverage,
        mode: null,
      }
    }
    const search = await deps.hybridSearch({
      question: command.questionText,
      referenceDate: date,
      families: decision.coveredFamilies,
      ...(command.zeroDataRetentionOnly === undefined
        ? {}
        : { zeroDataRetentionOnly: command.zeroDataRetentionOnly }),
      ...(command.signal === undefined ? {} : { signal: command.signal }),
    })
    if (search.evidence.length === 0 || maxRrf(search.evidence) < deps.minEvidenceRrf) {
      return {
        outcome: RetrievalOutcome.Refused,
        reason: RefusalReason.NoEvidence,
        reference: resolution.reference,
        coverage: decision.coverage,
        mode: search.mode,
      }
    }
    return {
      outcome: RetrievalOutcome.Evidence,
      reference: await referenceWithBoundary(
        deps,
        resolution.reference,
        decision.coveredFamilies,
        search,
      ),
      mode: search.mode,
      evidence: search.evidence,
      uncoveredFamilies: decision.uncoveredFamilies,
      stableKeys: search.stableKeys,
      rewrittenQuery: search.rewrittenQuery,
    }
  }
}
