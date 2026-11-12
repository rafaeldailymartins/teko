import { z } from 'zod'
import { type RerankerPort, RerankerUnavailableError } from '#app/ports/reranker-port.ts'
import { workersAiEndpoint } from '../../embeddings/workers-ai/workers-ai-embedding-adapter.ts'

/**
 * `bge-reranker-base` pelo Workers AI (REST): `POST https://api.cloudflare.com/client/v4/accounts/
 * {id}/ai/run/@cf/baai/bge-reranker-base` com `{ query, contexts: [{ text }] }`. Resposta
 * `{ result: { response: [{ id, score }] }, success }`, com `id` = posição do texto em `contexts`
 * (ADR 0027). Mesmo host fixo do adapter de embeddings.
 *
 * Falhas de rede e HTTP, resposta fora do esquema ou sem nota para algum texto viram
 * `RerankerUnavailableError`, que mantém a ordem do RRF em vez de falhar a pergunta.
 */

export const BGE_RERANKER_MODEL = '@cf/baai/bge-reranker-base'

const responseSchema = z.object({
  success: z.boolean(),
  result: z
    .object({ response: z.array(z.object({ id: z.int().nonnegative(), score: z.number() })) })
    .nullable()
    .optional(),
})

export interface WorkersAiRerankerOptions {
  readonly accountId: string
  readonly apiToken: string
  /** Injetável nos testes; o padrão é o `fetch` global. */
  readonly fetch?: typeof fetch
}

export function createWorkersAiRerankerAdapter(options: WorkersAiRerankerOptions): RerankerPort {
  const endpoint = workersAiEndpoint(options.accountId, BGE_RERANKER_MODEL)
  const doFetch = options.fetch ?? fetch
  return {
    model: BGE_RERANKER_MODEL,
    async rerank(query, texts, rerankOptions) {
      if (texts.length === 0) {
        return []
      }
      let response: Response
      try {
        response = await doFetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query, contexts: texts.map((text) => ({ text })) }),
          ...(rerankOptions?.signal === undefined ? {} : { signal: rerankOptions.signal }),
        })
      } catch (error) {
        throw new RerankerUnavailableError('Workers AI inacessível', { cause: error })
      }
      if (!response.ok) {
        throw new RerankerUnavailableError(`Workers AI respondeu HTTP ${String(response.status)}`)
      }
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success || !parsed.data.success || !parsed.data.result) {
        throw new RerankerUnavailableError('Workers AI devolveu uma resposta inesperada')
      }
      const scores: (number | undefined)[] = Array.from({ length: texts.length })
      for (const { id, score } of parsed.data.result.response) {
        if (id < texts.length) {
          scores[id] = score
        }
      }
      if (scores.some((score) => score === undefined)) {
        throw new RerankerUnavailableError(
          `Workers AI devolveu notas para ${String(parsed.data.result.response.length)} de ${String(texts.length)} textos`,
        )
      }
      return scores as number[]
    },
  }
}
