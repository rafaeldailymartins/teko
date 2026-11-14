import { RetrievalMode } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import { type Evidence, rerankText } from '#domain/qa/evidence.ts'
import { extractProvisionRefs } from '#domain/qa/provision-refs.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import { type RerankerPort, RerankerUnavailableError } from '../ports/reranker-port.ts'
import type { SearchRepository } from '../ports/search-repository.ts'
import type { QueryRewriter } from '../services/query-rewriter.ts'

/**
 * `HybridSearch`: embedding da pergunta (teto de 3 s) e uma única instrução SQL com os três braços
 * (léxico, vetorial e referência exata) fundidos por RRF. Se o embedding falhar ou estourar o teto,
 * a busca degrada para `lexical_only` (rotulada no `data-meta`), sem falhar a pergunta.
 *
 * Com reranker (ADR 0027): a instrução traz `rerankCandidates` candidatos, o reranker os reordena
 * pela relevância do `rerankText` (caminho, ancestrais e conteúdo) para a pergunta e a busca
 * devolve os `limit` primeiros. Falha ou teto do reranker mantêm a ordem do RRF (`reranked: false`).
 *
 * Com reescrita (ADR 0034): o LLM transforma a pergunta numa consulta na linguagem do corpus. O
 * braço léxico recebe a pergunta e a consulta (OU dos lexemas das duas), o embedding e o reranker
 * recebem a consulta, e as referências citadas saem das duas. Sem consulta (falha, teto ou saída
 * vazia), a busca segue com a pergunta.
 */
interface HybridSearchCommand {
  /** Pergunta já redigida. */
  readonly question: string
  readonly referenceDate: IsoDate
  /** Famílias cobertas na data (o `CheckCoverage` já tirou as demais). */
  readonly families: readonly string[]
  /** Usuário do EEE, Reino Unido ou Suíça: a reescrita só usa modelos com ZDR. */
  readonly zeroDataRetentionOnly?: boolean
  readonly signal?: AbortSignal
}

export interface HybridSearchResult {
  readonly mode: RetrievalMode
  readonly evidence: readonly Evidence[]
  /** `stable_key` reconhecidas na pergunta (braço `exact`). */
  readonly stableKeys: readonly string[]
  /** A ordem veio do reranker (`false`: sem reranker, ou ele falhou e valeu a ordem do RRF). */
  readonly reranked: boolean
  /** Consulta reescrita pelo LLM que a busca usou; `null` sem reescrita. */
  readonly rewrittenQuery: string | null
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
  /** Teto do reranker antes de manter a ordem do RRF (ADR 0027: 3 s). */
  readonly rerankTimeoutMs: number
  /** `null` = sem reescrita (`QUERY_REWRITE_ENABLED` desligada ou sem cadeia de LLM). */
  readonly rewriter: QueryRewriter | null
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
  return async ({ question, referenceDate, families, zeroDataRetentionOnly, signal }) => {
    if (families.length === 0) {
      const stableKeys = extractProvisionRefs(question, families)
      return {
        mode: RetrievalMode.Hybrid,
        evidence: [],
        stableKeys,
        reranked: false,
        rewrittenQuery: null,
      }
    }
    const rewrittenQuery =
      deps.rewriter === null
        ? null
        : await deps.rewriter(question, {
            zeroDataRetentionOnly: zeroDataRetentionOnly ?? false,
            ...(signal === undefined ? {} : { signal }),
          })
    const query = rewrittenQuery ?? question
    const stableKeys =
      rewrittenQuery === null
        ? extractProvisionRefs(question, families)
        : [
            ...new Set([
              ...extractProvisionRefs(question, families),
              ...extractProvisionRefs(rewrittenQuery, families),
            ]),
          ]
    const embedding = await embedQuestion(deps, query, signal)
    const { reranker } = deps
    const candidates = await deps.searchRepository.search({
      text: rewrittenQuery === null ? question : `${question}\n${rewrittenQuery}`,
      embedding,
      referenceDate,
      families,
      stableKeys,
      reviewStatuses: deps.reviewStatuses,
      limit: reranker === null ? deps.limit : Math.max(deps.limit, deps.rerankCandidates),
    })
    const mode = embedding === null ? RetrievalMode.LexicalOnly : RetrievalMode.Hybrid
    const scores =
      reranker === null || candidates.length < 2
        ? null
        : await rerankScores({ ...deps, reranker }, query, candidates, signal)
    if (scores === null) {
      return {
        mode,
        evidence: candidates.slice(0, deps.limit),
        stableKeys,
        reranked: false,
        rewrittenQuery,
      }
    }
    // Ordem estável: empate de nota mantém a ordem do RRF.
    const evidence = candidates
      .map((item, index) => ({ item, index, score: scores[index] ?? Number.NEGATIVE_INFINITY }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, deps.limit)
      .map(({ item }) => item)
    return { mode, evidence, stableKeys, reranked: true, rewrittenQuery }
  }
}
