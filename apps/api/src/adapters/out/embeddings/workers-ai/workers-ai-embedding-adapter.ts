import { z } from 'zod'
import { type EmbeddingPort, EmbeddingUnavailableError } from '#app/ports/embedding-port.ts'

/**
 * BGE-M3 pelo Workers AI (REST): `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/
 * @cf/baai/bge-m3` com `{ text: string[] }`. Resposta `{ result: { shape: [n, 1024], data,
 * pooling: 'cls' }, success }` (spike F1 (f)); o custo real vem em `result.meta.neurons` e no header
 * `cf-ai-neurons`, e é ele que a ingestão soma contra o orçamento.
 *
 * O host é fixo (`api.cloudflare.com`): nenhuma URL de provedor vem do ambiente (asserção de boot).
 * Falhas de rede e HTTP viram `EmbeddingUnavailableError`, que degrada a busca para
 * `lexical_only` em vez de falhar a pergunta.
 */

const WORKERS_AI_HOST = 'api.cloudflare.com'
export const BGE_M3_MODEL = '@cf/baai/bge-m3'
export const BGE_M3_DIMENSIONS = 1024

const responseSchema = z.object({
  success: z.boolean(),
  result: z
    .object({
      shape: z.tuple([z.int(), z.int()]),
      data: z.array(z.array(z.number())),
      meta: z.object({ neurons: z.number().optional() }).optional(),
    })
    .nullable()
    .optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
})

export interface WorkersAiOptions {
  readonly accountId: string
  readonly apiToken: string
  /** Injetável nos testes; o padrão é o `fetch` global. */
  readonly fetch?: typeof fetch
  /** Recebe o custo real de cada chamada (neurons). */
  readonly onUsage?: (usage: { readonly neurons: number | null; readonly texts: number }) => void
}

export function workersAiEndpoint(accountId: string): URL {
  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    throw new RangeError('CF_ACCOUNT_ID inválido (esperado: 32 dígitos hexadecimais)')
  }
  const url = new URL(
    `https://${WORKERS_AI_HOST}/client/v4/accounts/${accountId}/ai/run/${BGE_M3_MODEL}`,
  )
  if (url.host !== WORKERS_AI_HOST) {
    throw new RangeError(`host inesperado para o Workers AI: ${url.host}`)
  }
  return url
}

function neuronsFrom(header: string | null, body: number | undefined): number | null {
  if (body !== undefined) {
    return body
  }
  const parsed = header === null ? Number.NaN : Number(header)
  return Number.isFinite(parsed) ? parsed : null
}

export function createWorkersAiEmbeddingAdapter(options: WorkersAiOptions): EmbeddingPort {
  const endpoint = workersAiEndpoint(options.accountId)
  const doFetch = options.fetch ?? fetch
  return {
    model: BGE_M3_MODEL,
    dimensions: BGE_M3_DIMENSIONS,
    async embed(texts, embedOptions) {
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
          body: JSON.stringify({ text: texts }),
          ...(embedOptions?.signal === undefined ? {} : { signal: embedOptions.signal }),
        })
      } catch (error) {
        throw new EmbeddingUnavailableError('Workers AI inacessível', { cause: error })
      }
      if (!response.ok) {
        throw new EmbeddingUnavailableError(`Workers AI respondeu HTTP ${String(response.status)}`)
      }
      const parsed = responseSchema.safeParse(await response.json())
      if (!parsed.success || !parsed.data.success || !parsed.data.result) {
        throw new EmbeddingUnavailableError('Workers AI devolveu uma resposta inesperada')
      }
      const { data, shape, meta } = parsed.data.result
      if (
        shape[0] !== texts.length ||
        shape[1] !== BGE_M3_DIMENSIONS ||
        data.length !== texts.length
      ) {
        throw new EmbeddingUnavailableError(
          `Workers AI devolveu shape [${shape.join(', ')}] para ${String(texts.length)} textos`,
        )
      }
      options.onUsage?.({
        neurons: neuronsFrom(response.headers.get('cf-ai-neurons'), meta?.neurons),
        texts: texts.length,
      })
      return data
    },
  }
}
