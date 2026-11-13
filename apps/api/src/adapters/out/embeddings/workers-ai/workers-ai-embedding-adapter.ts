import { z } from 'zod'
import {
  type EmbeddingPort,
  EmbeddingQuotaExceededError,
  EmbeddingUnavailableError,
} from '#app/ports/embedding-port.ts'

/**
 * BGE-M3 pelo Workers AI (REST): `POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/
 * @cf/baai/bge-m3` com `{ text: string[] }`. Resposta `{ result: { shape: [n, 1024], data,
 * pooling: 'cls' }, success }` (spike F1 (f)); o custo real vem em `result.meta.neurons` e no header
 * `cf-ai-neurons`, e é ele que a ingestão soma contra o orçamento.
 *
 * O host é fixo (`api.cloudflare.com`): nenhuma URL de provedor vem do ambiente (asserção de boot).
 * Falhas de rede e HTTP, corpo ilegível (não JSON ou conexão encerrada no meio da leitura) e
 * resposta fora do esquema viram `EmbeddingUnavailableError`, que degrada a busca para
 * `lexical_only` (e que o `embedWithRetry` da ingestão repete) em vez de falhar a pergunta. A cota
 * diária esgotada (HTTP 429, código 3036) vira `EmbeddingQuotaExceededError`: a ingestão para como
 * `budget_exhausted`, sem repetir.
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

/** Endpoint REST de um modelo do Workers AI (o host é fixo; o reranker usa a mesma função). */
export function workersAiEndpoint(accountId: string, model: string = BGE_M3_MODEL): URL {
  if (!/^[0-9a-f]{32}$/.test(accountId)) {
    throw new RangeError('CF_ACCOUNT_ID inválido (esperado: 32 dígitos hexadecimais)')
  }
  const url = new URL(`https://${WORKERS_AI_HOST}/client/v4/accounts/${accountId}/ai/run/${model}`)
  if (url.host !== WORKERS_AI_HOST) {
    throw new RangeError(`host inesperado para o Workers AI: ${url.host}`)
  }
  return url
}

/** Código interno do Workers AI para "daily free allocation" esgotada (HTTP 429). */
const DAILY_QUOTA_ERROR_CODE = 3036

const quotaErrorSchema = z.object({
  errors: z.array(z.object({ code: z.number().optional(), message: z.string().optional() })),
})

/**
 * 429 com o código 3036 é a cota diária (zera às 00:00 UTC); o 429 com 3040 ("capacity
 * temporarily exceeded") é transitório e segue degradável, com retry.
 */
async function isDailyQuotaExceeded(response: Response): Promise<boolean> {
  if (response.status !== 429) {
    return false
  }
  try {
    const parsed = quotaErrorSchema.safeParse(await response.json())
    return (
      parsed.success &&
      parsed.data.errors.some(
        (error) =>
          error.code === DAILY_QUOTA_ERROR_CODE ||
          (error.message ?? '').includes('daily free allocation'),
      )
    )
  } catch {
    return false
  }
}

/** Resposta do Workers AI já lida: o corpo JSON e os headers. */
interface WorkersAiReply {
  readonly body: unknown
  readonly headers: Headers
}

/**
 * `POST` JSON a um modelo do Workers AI (embeddings e reranker). Qualquer falha antes de o corpo
 * estar lido (rede, HTTP, corpo que não é JSON, conexão encerrada no meio da leitura) vira o erro
 * degradável de quem chama, criado por `unavailable`; a cota diária esgotada (429/3036) vira o de
 * `quotaExceeded`, se quem chama o informar (a ingestão para em vez de repetir).
 */
export async function postWorkersAi(
  request: {
    readonly endpoint: URL
    readonly apiToken: string
    readonly payload: unknown
    readonly signal?: AbortSignal | undefined
    readonly fetch: typeof fetch
  },
  unavailable: (message: string, options?: { readonly cause?: unknown }) => Error,
  quotaExceeded?: (message: string) => Error,
): Promise<WorkersAiReply> {
  let response: Response
  let body: unknown
  try {
    response = await request.fetch(request.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${request.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request.payload),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    })
  } catch (error) {
    throw unavailable('Workers AI inacessível', { cause: error })
  }
  if (!response.ok) {
    if (quotaExceeded !== undefined && (await isDailyQuotaExceeded(response))) {
      throw quotaExceeded('Workers AI: cota diária de neurons esgotada (HTTP 429, código 3036)')
    }
    throw unavailable(`Workers AI respondeu HTTP ${String(response.status)}`)
  }
  try {
    body = await response.json()
  } catch (error) {
    throw unavailable('Workers AI devolveu um corpo ilegível', { cause: error })
  }
  return { body, headers: response.headers }
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
      const reply = await postWorkersAi(
        {
          endpoint,
          apiToken: options.apiToken,
          payload: { text: texts },
          signal: embedOptions?.signal,
          fetch: doFetch,
        },
        (message, errorOptions) => new EmbeddingUnavailableError(message, errorOptions),
        (message) => new EmbeddingQuotaExceededError(message),
      )
      const parsed = responseSchema.safeParse(reply.body)
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
        neurons: neuronsFrom(reply.headers.get('cf-ai-neurons'), meta?.neurons),
        texts: texts.length,
      })
      return data
    },
  }
}
