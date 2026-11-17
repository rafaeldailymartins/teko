import type {
  Citation,
  FeedbackRating,
  FeedbackReason,
  LlmProvider,
  RetrievalMode,
} from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate, ReferenceSource, ValidityInterval } from '@teko/shared/vigencia'
import type { LlmUsage } from './llm-port.ts'

/**
 * Traces de LLM (Langfuse, `docs/architecture/observabilidade.md`, "Langfuse Cloud Hobby (EU)").
 * A aplicação decide **se** uma pergunta é rastreada (`TraceSampler`, `services/trace-sampler.ts`)
 * e conta as units; o adapter dá os nomes (verbo no início, estáveis) e cria as observations:
 *
 * - raiz (`answer-question`): a pergunta redigida na entrada e a resposta na saída; usuário com
 *   hash, conversa como sessão, data e origem, versões, cache, desfecho e citações na metadata;
 * - busca (`retrieve-context`, retriever): a consulta, a reescrita, a data e as famílias na
 *   entrada, e os dispositivos recuperados (sem o texto) na saída;
 * - chamadas de LLM (`generate-answer` e `rewrite-query`): uma generation por provedor tentado,
 *   com as mensagens no formato OpenAI, o raciocínio do modelo, uso, custo a preço de tabela e TTFT.
 *
 * O trace leva o mesmo `trace_id` do OTel (é filho do span da requisição). Nada aqui lança nem
 * faz E/S síncrona: a exportação é do span processor, no flush por requisição.
 */

/** O que o trace sabe da pergunta desde o início. */
export interface QueryTraceStart {
  readonly questionId: string
  /** Id da conta; o adapter só o exporta como hash. */
  readonly userId: string
  /** Id da conversa (UUID interno, sem PII): agrupa os turnos numa sessão. */
  readonly conversationId: string
  /** Pergunta já redigida (`PiiRedactor`). */
  readonly question: string
  readonly locale: Locale
  readonly families: readonly string[]
  readonly referenceDate: IsoDate
  readonly referenceSource: ReferenceSource
  readonly corpusVersion: number | null
  readonly promptVersion: string
  /** Resposta do cache exato (o trace sai só com a raiz). */
  readonly cached: boolean
  readonly startedAtMs: number
}

/** Um dispositivo entregue pela busca, na ordem final (sem o texto, que vai no prompt). */
export interface RetrievedItem {
  readonly chunkId: string
  readonly stableKey: string
  readonly label: string
  /** Caminho de títulos do dispositivo ("RCTE > … > Art. 20 > inciso I"). */
  readonly headingPath: string
  readonly family: string
  /** Versão de documento citada (rótulo, como "Guia Prático 3.1.9"). */
  readonly documentVersion: string
  readonly validity: ValidityInterval
  /** RRF (4 casas) e posição em cada braço da busca (`null` = ausente do braço). */
  readonly rrf: number
  readonly lexicalRank: number | null
  readonly semanticRank: number | null
  readonly referenceRank: number | null
}

/** A busca híbrida como o retriever a mostra. */
export interface RetrievalSummary {
  /** Pergunta redigida que entrou na busca. */
  readonly query: string
  /** Consulta reescrita pelo LLM que a busca usou (ADR 0034); `null` sem reescrita. */
  readonly rewrittenQuery: string | null
  /** Data de referência resolvida; `null` quando a busca não chegou a resolvê-la. */
  readonly referenceDate: IsoDate | null
  /** Famílias pedidas (vazio = todas). */
  readonly families: readonly string[]
  /** `null` quando a busca nem rodou (data fora da cobertura). */
  readonly mode: RetrievalMode | null
  /** Evidências entregues ao prompt (top-k), na ordem final. */
  readonly items: readonly RetrievedItem[]
  /** A ordem final veio do reranker. */
  readonly reranked: boolean
  /** Famílias pedidas sem cobertura na data. */
  readonly uncoveredFamilies: readonly string[]
  /** Recusa decidida na busca (`out_of_coverage`, `no_evidence`), ou `null`. */
  readonly refusalReason: string | null
}

/** Para que serve a chamada de LLM: a resposta ou a reescrita da pergunta (ADR 0034). */
type GenerationPurpose = 'answer' | 'rewrite'

export interface GenerationStart {
  readonly purpose: GenerationPurpose
  readonly provider: LlmProvider
  readonly model: string
  /** Versão do prompt da chamada (`answer@…` ou `rewrite@…`). */
  readonly promptVersion: string
  /** System prompt e prompt do usuário, como o modelo os recebeu. */
  readonly system: string
  readonly prompt: string
  readonly temperature: number
  readonly maxOutputTokens: number
  readonly startedAtMs: number
}

export interface GenerationEnd {
  /** `null`: a chamada terminou sem erro; senão, o tipo da falha (`rate_limited`, `aborted`...). */
  readonly error: string | null
  readonly usage: LlmUsage
  /** Custo a preço de tabela (`services/pricing.ts`); o faturado é sempre 0. */
  readonly cost: { readonly input: number; readonly output: number; readonly total: number }
  readonly firstTokenAtMs: number | null
  /** Texto gerado (já sem o canary), só na chamada que respondeu. */
  readonly output: string | null
  /** Raciocínio que o modelo devolveu (Gemini: o resumo; `gpt-oss`: o texto), ou `null`. */
  readonly reasoning: string | null
  readonly endedAtMs: number
}

export interface QueryTraceEnd {
  /** `answered`, `refused`, `failed` ou `aborted` (o mesmo `outcome` das métricas). */
  readonly outcome: string
  readonly refusalReason: string | null
  /** Código do erro da falha (`upstream_unavailable`, `internal`...), só no desfecho `failed`. */
  readonly failure?: string
  /** Resposta final em Markdown, quando houve. */
  readonly answer: string | null
  /** Citações da resposta (válidas e inválidas, com o trecho), para avaliar a fidelidade. */
  readonly citations: readonly Citation[]
  readonly corpusVersion: number | null
  readonly endedAtMs: number
}

export interface RetrievalObservation {
  end(summary: RetrievalSummary, endedAtMs: number): void
}

export interface GenerationObservation {
  end(result: GenerationEnd): void
}

/** As observations de uma pergunta rastreada. */
export interface QueryObservations {
  /** `trace_id` W3C do trace (o mesmo do OTel). */
  readonly traceId: string
  retrieval(startedAtMs: number): RetrievalObservation
  generation(start: GenerationStart): GenerationObservation
  end(result: QueryTraceEnd): void
}

export interface LlmTracingPort {
  /** Abre o trace de uma pergunta já amostrada. */
  startQuery(start: QueryTraceStart): QueryObservations
}

/** Feedback do usuário a gravar no trace (score `user_feedback`; 👎 vai à annotation queue). */
export interface TraceFeedback {
  readonly traceId: string
  readonly questionId: string
  readonly rating: FeedbackRating
  readonly reason: FeedbackReason | null
}

export interface TraceFeedbackPort {
  /** Grava o score e, no 👎, põe o trace na annotation queue. Pode rejeitar (rede, credencial). */
  recordFeedback(feedback: TraceFeedback): Promise<void>
}
