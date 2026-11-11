import { RetrievalMode } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import type { Evidence } from '#domain/qa/evidence.ts'
import { extractProvisionRefs } from '#domain/qa/provision-refs.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import type { SearchRepository } from '../ports/search-repository.ts'

/**
 * `HybridSearch`: embedding da pergunta (teto de 3 s) e uma única instrução SQL com os três braços
 * (léxico, vetorial e referência exata) fundidos por RRF. Se o embedding falhar ou estourar o teto,
 * a busca degrada para `lexical_only` (rotulada no `data-meta`), sem falhar a pergunta.
 */
interface HybridSearchCommand {
  /** Pergunta já redigida. */
  readonly question: string
  readonly referenceDate: IsoDate
  /** Famílias cobertas na data (o `CheckCoverage` já tirou as demais). */
  readonly families: readonly string[]
  readonly signal?: AbortSignal
}

export interface HybridSearchResult {
  readonly mode: RetrievalMode
  readonly evidence: readonly Evidence[]
  /** `stable_key` reconhecidas na pergunta (braço `exact`). */
  readonly stableKeys: readonly string[]
}

export type HybridSearch = (command: HybridSearchCommand) => Promise<HybridSearchResult>

export interface HybridSearchDeps {
  readonly embeddings: EmbeddingPort
  readonly searchRepository: SearchRepository
  readonly reviewStatuses: readonly ReviewStatus[]
  /** Teto do embedding da pergunta (plano: 3 s). */
  readonly embeddingTimeoutMs: number
  /** Evidências devolvidas (plano: 12). */
  readonly limit: number
}

async function embedQuestion(
  deps: HybridSearchDeps,
  question: string,
  signal: AbortSignal | undefined,
): Promise<number[] | null> {
  const timeout = AbortSignal.timeout(deps.embeddingTimeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    const [vector] = await deps.embeddings.embed([question], { signal: combined })
    return vector ?? null
  } catch (error) {
    // Cancelamento do cliente não é degradação: propaga. Só indisponibilidade do provedor e o
    // teto de tempo degradam; qualquer outro erro (ex.: miss do fake em modo strict) é bug.
    if (signal?.aborted === true) {
      throw error
    }
    if (error instanceof EmbeddingUnavailableError || timeout.aborted) {
      return null
    }
    throw error
  }
}

export function createHybridSearch(deps: HybridSearchDeps): HybridSearch {
  return async ({ question, referenceDate, families, signal }) => {
    const stableKeys = extractProvisionRefs(question, families)
    if (families.length === 0) {
      return { mode: RetrievalMode.Hybrid, evidence: [], stableKeys }
    }
    const embedding = await embedQuestion(deps, question, signal)
    const evidence = await deps.searchRepository.search({
      text: question,
      embedding,
      referenceDate,
      families,
      stableKeys,
      reviewStatuses: deps.reviewStatuses,
      limit: deps.limit,
    })
    return {
      mode: embedding === null ? RetrievalMode.LexicalOnly : RetrievalMode.Hybrid,
      evidence,
      stableKeys,
    }
  }
}
