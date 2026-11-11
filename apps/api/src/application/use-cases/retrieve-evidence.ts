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
import type { HybridSearch } from './hybrid-search.ts'
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
    }

export type RetrieveEvidence = (command: RetrieveEvidenceCommand) => Promise<RetrievalResult>

export interface RetrieveEvidenceDeps {
  readonly resolveReferenceDate: ResolveReferenceDate
  readonly checkCoverage: CheckCoverage
  readonly hybridSearch: HybridSearch
  /** Abaixo disso (maior RRF da lista) a pergunta é recusada como `no_evidence`. */
  readonly minEvidenceRrf: number
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
      reference: markPeriodBoundary(
        resolution.reference,
        search.evidence.map((item) => item.validity),
      ),
      mode: search.mode,
      evidence: search.evidence,
      uncoveredFamilies: decision.uncoveredFamilies,
      stableKeys: search.stableKeys,
    }
  }
}
