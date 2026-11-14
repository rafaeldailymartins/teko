import { RetrievalMode } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import { type Evidence, rerankText } from '#domain/qa/evidence.ts'
import { extractProvisionRefs } from '#domain/qa/provision-refs.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import { type RerankerPort, RerankerUnavailableError } from '../ports/reranker-port.ts'
import type { SearchRepository } from '../ports/search-repository.ts'
import { type TranslatorPort, TranslatorUnavailableError } from '../ports/translator-port.ts'

/**
 * `HybridSearch`: embedding da pergunta (teto de 3 s) e uma única instrução SQL com os três braços
 * (léxico, vetorial e referência exata) fundidos por RRF. Se o embedding falhar ou estourar o teto,
 * a busca degrada para `lexical_only` (rotulada no `data-meta`), sem falhar a pergunta.
 *
 * Com reranker (ADR 0027): a instrução traz `rerankCandidates` candidatos, o reranker os reordena
 * pela relevância do `rerankText` (caminho, ancestrais e conteúdo) para a pergunta e a busca devolve os `limit`
 * primeiros. Falha ou teto do reranker mantêm a ordem do RRF (`reranked: false`).
 *
 * Pergunta em inglês (`locale: 'en'`) com tradutor (ADR 0034): os três braços e o reranker usam a
 * tradução para o português; as referências citadas saem das duas versões. Falha ou teto do
 * tradutor seguem com a pergunta original.
 */
interface HybridSearchCommand {
  /** Pergunta já redigida. */
  readonly question: string
  readonly referenceDate: IsoDate
  /** Famílias cobertas na data (o `CheckCoverage` já tirou as demais). */
  readonly families: readonly string[]
  /** Idioma da pergunta (o da interface); `en` passa pelo tradutor, se houver. */
  readonly locale?: Locale
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
  /** Teto do reranker antes de manter a ordem do RRF (ADR 0027: 3 s). */
  readonly rerankTimeoutMs: number
  /** `null` = sem tradução (a pergunta em inglês vai como veio). */
  readonly translator: TranslatorPort | null
  /** Teto da tradução antes de seguir com a pergunta original (ADR 0034: 2 s). */
  readonly translationTimeoutMs: number
}

/**
 * Texto da busca: a pergunta, ou a tradução dela para o português quando veio em inglês e há
 * tradutor. Indisponibilidade e teto seguem com a original; cancelamento do cliente propaga.
 */
async function searchText(
  deps: HybridSearchDeps,
  question: string,
  locale: Locale | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (locale !== 'en' || deps.translator === null) {
    return question
  }
  const timeout = AbortSignal.timeout(deps.translationTimeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  try {
    return await deps.translator.toPortuguese(question, { signal: combined })
  } catch (error) {
    if (signal?.aborted === true) {
      throw error
    }
    if (error instanceof TranslatorUnavailableError || timeout.aborted) {
      return question
    }
    throw error
  }
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
  return async ({ question, referenceDate, families, locale, signal }) => {
    if (families.length === 0) {
      const stableKeys = extractProvisionRefs(question, families)
      return { mode: RetrievalMode.Hybrid, evidence: [], stableKeys, reranked: false }
    }
    const text = await searchText(deps, question, locale, signal)
    const stableKeys = [
      ...new Set([
        ...extractProvisionRefs(question, families),
        ...extractProvisionRefs(text, families),
      ]),
    ]
    const embedding = await embedQuestion(deps, text, signal)
    const { reranker } = deps
    const candidates = await deps.searchRepository.search({
      text,
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
        : await rerankScores({ ...deps, reranker }, text, candidates, signal)
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
