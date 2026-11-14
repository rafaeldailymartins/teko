import { RetrievalMode } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import { type Evidence, rerankText } from '#domain/qa/evidence.ts'
import { extractProvisionRefs } from '#domain/qa/provision-refs.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import { type RerankerPort, RerankerUnavailableError } from '../ports/reranker-port.ts'
import type { SearchRepository } from '../ports/search-repository.ts'

/**
 * `HybridSearch`: embedding da pergunta (teto de 3 s) e uma única instrução SQL com os três braços
 * (léxico, vetorial e referência exata) fundidos por RRF. Se o embedding falhar ou estourar o teto,
 * a busca degrada para `lexical_only` (rotulada no `data-meta`), sem falhar a pergunta.
 *
 * Com reranker (ADR 0027): a instrução traz `rerankCandidates` candidatos, o reranker os reordena
 * pela relevância do `rerankText` (caminho, ancestrais e conteúdo) para a pergunta e a busca devolve os `limit`
 * primeiros. Falha ou teto do reranker mantêm a ordem do RRF (`reranked: false`).
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
  /** A ordem veio do reranker (`false`: sem reranker, ou ele falhou e valeu a ordem do RRF). */
  readonly reranked: boolean
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
  /** `null` = sem reranker (ordem do RRF). */
  readonly reranker: RerankerPort | null
  /** Candidatos pedidos à instrução quando há reranker (ADR 0027: 40). */
  readonly rerankCandidates: number
  /** Parentes dos candidatos do topo somados ao pool do reranker (ADR 0027, adendo: 20). */
  readonly rerankExpansion: number
  /** Teto do reranker antes de manter a ordem do RRF (ADR 0027: 3 s). */
  readonly rerankTimeoutMs: number
}

/**
 * Notas do reranker para os candidatos, ou `null` para manter a ordem do RRF (indisponível ou
 * teto). Cancelamento do cliente propaga, como no embedding.
 */
async function rerankScores(
  deps: HybridSearchDeps & { readonly reranker: RerankerPort },
  question: string,
  evidence: readonly Evidence[],
  signal: AbortSignal | undefined,
): Promise<number[] | null> {
  const timeout = AbortSignal.timeout(deps.rerankTimeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    return await deps.reranker.rerank(question, evidence.map(rerankText), { signal: combined })
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }
    if (error instanceof RerankerUnavailableError || timeout.aborted) {
      return null
    }
    throw error
  }
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
      return { mode: RetrievalMode.Hybrid, evidence: [], stableKeys, reranked: false }
    }
    const embedding = await embedQuestion(deps, question, signal)
    const { reranker } = deps
    const candidates = await deps.searchRepository.search({
      text: question,
      embedding,
      referenceDate,
      families,
      stableKeys,
      reviewStatuses: deps.reviewStatuses,
      limit: reranker === null ? deps.limit : Math.max(deps.limit, deps.rerankCandidates),
      expansion: reranker === null ? 0 : deps.rerankExpansion,
    })
    const mode = embedding === null ? RetrievalMode.LexicalOnly : RetrievalMode.Hybrid
    const scores =
      reranker === null || candidates.length < 2
        ? null
        : await rerankScores({ ...deps, reranker }, question, candidates, signal)
    if (scores === null) {
      return { mode, evidence: candidates.slice(0, deps.limit), stableKeys, reranked: false }
    }
    // Ordem estável: empate de nota mantém a ordem do RRF.
    const evidence = candidates
      .map((item, index) => ({ item, index, score: scores[index] ?? Number.NEGATIVE_INFINITY }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, deps.limit)
      .map(({ item }) => item)
    return { mode, evidence, stableKeys, reranked: true }
  }
}
