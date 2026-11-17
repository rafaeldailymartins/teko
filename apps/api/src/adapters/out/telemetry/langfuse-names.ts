/**
 * Nomes fixos no Langfuse, compartilhados pela API (`langfuse.ts` e `langfuse-api.ts`) e pelo job
 * `langfuse` do `ops.yml` (`scripts/langfuse-ops.ts`, que cria a score config e a annotation queue).
 * Sem imports: o script da raiz o importa direto.
 *
 * Os nomes do trace e das observations funcionam como API (evaluators, dashboards e filtros salvos
 * os referenciam): verbo no início, sem valor dinâmico nem nome de modelo, e estáveis. Trocar um
 * deles exige refazer o que o referencia no Langfuse.
 */

/** Trace (e observation raiz) de uma pergunta. */
export const QUERY_TRACE_NAME = 'answer-question'
/** Retriever da busca híbrida. */
export const RETRIEVAL_OBSERVATION_NAME = 'retrieve-context'
/** Generations por finalidade da chamada de LLM: a resposta e a reescrita da pergunta (ADR 0034). */
export const GENERATION_NAMES = {
  answer: 'generate-answer',
  rewrite: 'rewrite-query',
} as const

/** Score do polegar (BOOLEAN: 1 = 👍, 0 = 👎) e a score config de mesmo nome. */
export const FEEDBACK_SCORE_NAME = 'user_feedback'
/** Annotation queue do 👎 (triagem mensal, ADR 0031). */
export const FEEDBACK_QUEUE_NAME = 'teko-feedback-negativo'
