import type { LlmProvider, RefusalReason, RetrievalMode } from '@teko/shared/contracts'

/**
 * Sinais de operação da API (métricas OTel, `docs/architecture/observabilidade.md`). A aplicação
 * só conhece esta porta; os instrumentos (nomes, unidades e atributos) ficam todos num módulo do
 * adapter (`adapters/out/telemetry/metrics.ts`). Sem telemetria configurada, a raiz de composição
 * usa `noopTelemetry`.
 *
 * Nenhum método lança nem faz E/S: gravar um sinal é síncrono e barato, e a exportação acontece no
 * flush por requisição (`BackgroundTasks`).
 */

/** Como terminou uma pergunta (`teko.rag.answers`, atributo `outcome`). */
export const AnswerOutcomeKind = {
  Answered: 'answered',
  Refused: 'refused',
  Failed: 'failed',
  Aborted: 'aborted',
} as const
export type AnswerOutcomeKind = (typeof AnswerOutcomeKind)[keyof typeof AnswerOutcomeKind]

export interface AnswerSignal {
  readonly outcome: AnswerOutcomeKind
  /** Só em `refused`. */
  readonly refusalReason: RefusalReason | null
  /** `null` quando a pergunta não chegou à busca (cache, recusa por cobertura, falha cedo). */
  readonly retrievalMode: RetrievalMode | null
  readonly cached: boolean
  readonly corpusVersion: number | null
}

/** Uma chamada de LLM que chegou a responder (`teko.llm.*`). */
interface LlmCallSignal {
  readonly provider: LlmProvider
  readonly model: string
  /** Tempo até o primeiro token, em segundos; `null` sem texto. */
  readonly ttftSeconds: number | null
  readonly inputTokens: number
  readonly outputTokens: number
  /** Custo a preço de tabela (`services/pricing.ts`), em USD; o faturado é 0. */
  readonly shadowCostUsd: number
}

/** Falha de um provedor de LLM (`teko.llm.provider_errors`, atributo `status`). */
export const ProviderErrorStatus = {
  RateLimited: '429',
  Unavailable: '5xx',
  Rejected: '4xx',
} as const
export type ProviderErrorStatus = (typeof ProviderErrorStatus)[keyof typeof ProviderErrorStatus]

/** Escopo da cota diária global (`teko.quota.used_ratio`, atributo `scope`), linha `global` de `usage_daily`. */
export const QuotaUsageScope = {
  Questions: 'global_questions',
  StreamSeconds: 'global_stream_seconds',
  Neurons: 'global_neurons',
} as const
export type QuotaUsageScope = (typeof QuotaUsageScope)[keyof typeof QuotaUsageScope]

export interface QuotaUsage {
  readonly scope: QuotaUsageScope
  /** Uso sobre o teto (pode passar de 1 se o teto baixar no meio do dia; teto 0 dá 1). */
  readonly ratio: number
}

/** Uma requisição HTTP respondida (`http.server.request.duration`). */
interface HttpRequestSignal {
  readonly method: string
  /** Rota declarada (`/api/v1/questions/:id/stream`), nunca a URL com IDs; `null` sem rota (404). */
  readonly route: string | null
  readonly statusCode: number
  readonly durationSeconds: number
}

export interface Telemetry {
  httpRequest(signal: HttpRequestSignal): void
  answer(signal: AnswerSignal): void
  /** Citações que o modelo fez a fontes inexistentes, removidas pelo `CitationValidator`. */
  citationsInvalidated(count: number, corpusVersion: number | null): void
  /** O modelo respondeu o sentinel `INSUFICIENTE`. */
  insufficientSentinel(corpusVersion: number | null): void
  /** Notas do reranker na ordem final (a primeira é o top-1; todas entram no top-12). */
  rerankerScores(scores: readonly number[]): void
  llmCall(signal: LlmCallSignal): void
  providerError(provider: LlmProvider, status: ProviderErrorStatus): void
  /** Fallback antes do primeiro token: do modelo que falhou para o que respondeu. */
  providerFallback(from: string, to: string): void
  quotaUsage(usages: readonly QuotaUsage[]): void
}

const ignore = (): void => {}

export const noopTelemetry: Telemetry = {
  httpRequest: ignore,
  answer: ignore,
  citationsInvalidated: ignore,
  insufficientSentinel: ignore,
  rerankerScores: ignore,
  llmCall: ignore,
  providerError: ignore,
  providerFallback: ignore,
  quotaUsage: ignore,
}
