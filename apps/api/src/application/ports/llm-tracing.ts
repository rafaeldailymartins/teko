import type {
  FeedbackRating,
  FeedbackReason,
  LlmProvider,
  RetrievalMode,
} from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate, ReferenceSource } from '@teko/shared/vigencia'
import type { LlmUsage } from './llm-port.ts'

/**
 * Traces de LLM (Langfuse, `docs/architecture/observabilidade.md`, "Langfuse Cloud Hobby (EU)").
 * A aplicação decide **se** uma pergunta é rastreada (`TraceSampler`, `services/trace-sampler.ts`)
 * e conta as units; o adapter só cria as observations do trace `rag-query`:
 *
 * - `rag-query` (raiz): usuário com hash, pergunta redigida, data e origem, versões, cache e
 *   cobertura;
 * - `retrieval`: candidatos por canal, top-k, RRF, reranker e modo da busca;
 * - `answer`: uma generation por provedor tentado, com uso, custo a preço de tabela e TTFT.
 *
 * O trace leva o mesmo `trace_id` do OTel (é filho do span da requisição). Nada aqui lança nem
 * faz E/S síncrona: a exportação é do span processor, no flush por requisição.
 */

/** O que o trace `rag-query` sabe da pergunta desde o início. */
export interface QueryTraceStart {
  readonly questionId: string
  /** Id da conta; o adapter só o exporta como hash. */
  readonly userId: string
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

/** Resumo da busca híbrida no span `retrieval`. */
export interface RetrievalSummary {
  /** `null` quando a busca nem rodou (data fora da cobertura). */
  readonly mode: RetrievalMode | null
  /** Evidências entregues ao prompt (top-k). */
  readonly topK: number
  /** Evidências do top-k presentes em cada braço da busca. */
  readonly candidatesByChannel: {
    readonly lexical: number
    readonly semantic: number
    readonly reference: number
  }
  /** RRF de cada evidência do top-k, na ordem final (4 casas). */
  readonly rrf: readonly number[]
  /** A ordem final veio do reranker. */
  readonly reranked: boolean
  /** A busca usou a consulta reescrita pelo LLM (ADR 0034). */
  readonly rewritten: boolean
  /** Famílias pedidas sem cobertura na data. */
  readonly uncoveredFamilies: readonly string[]
  /** Recusa decidida na busca (`out_of_coverage`, `no_evidence`), ou `null`. */
  readonly refusalReason: string | null
}

export interface GenerationStart {
  /** `answer` (a resposta) ou `rewrite` (a reescrita da pergunta, ADR 0034). */
  readonly name: 'answer' | 'rewrite'
  readonly provider: LlmProvider
  readonly model: string
  /** Prompt do usuário (pergunta redigida e, na resposta, os trechos); o system prompt fica de fora. */
  readonly input: string
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
  readonly endedAtMs: number
}

export interface QueryTraceEnd {
  /** `answered`, `refused`, `failed` ou `aborted` (o mesmo `outcome` das métricas). */
  readonly outcome: string
  readonly refusalReason: string | null
  /** Resposta final em Markdown, quando houve. */
  readonly answer: string | null
  readonly citations: number
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
  /** Abre o trace `rag-query` de uma pergunta já amostrada. */
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
