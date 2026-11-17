/**
 * Nomes fixos no Langfuse, compartilhados pela API (`langfuse-api.ts`) e pelo job `langfuse` do
 * `ops.yml` (`scripts/langfuse-ops.ts`, que cria a score config e a annotation queue). Sem imports:
 * o script da raiz o importa direto.
 */

/** Score do polegar (BOOLEAN: 1 = 👍, 0 = 👎) e a score config de mesmo nome. */
export const FEEDBACK_SCORE_NAME = 'user_feedback'
/** Annotation queue do 👎 (triagem mensal, ADR 0031). */
export const FEEDBACK_QUEUE_NAME = 'teko-feedback-negativo'
