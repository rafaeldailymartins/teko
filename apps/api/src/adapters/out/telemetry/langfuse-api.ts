import type { ErasurePort } from '#app/ports/account-repository.ts'
import type { TraceFeedback, TraceFeedbackPort } from '#app/ports/llm-tracing.ts'
import { FEEDBACK_QUEUE_NAME, FEEDBACK_SCORE_NAME } from './langfuse-names.ts'
import { langfuseUserId } from './langfuse-user.ts'

/**
 * API pública do Langfuse pelo `fetch` (o `@langfuse/client` depende do `mustache`, sem
 * proveniência): score `user_feedback`, annotation queue do 👎 e apagamento dos traces de um
 * usuário (`DeleteMyData`). Basic auth com as chaves do projeto; cada chamada tem teto próprio,
 * além do teto da tarefa pós-resposta que a carrega.
 */

export interface LangfuseApiConfig {
  /** Origem do Langfuse (`https://cloud.langfuse.com`, EU). */
  readonly baseUrl: string
  readonly publicKey: string
  readonly secretKey: string
  /** `environment` do score, o mesmo dos traces (`LANGFUSE_TRACING_ENVIRONMENT`). */
  readonly environment?: string
  readonly fetch?: typeof fetch
}

const REQUEST_TIMEOUT_MS = 1500
/** Traces por `DELETE /api/public/traces` (limite da API). */
const DELETE_BATCH = 1000
/** Início do uso do Langfuse pelo Tekó: a busca dos traces de um usuário começa aqui. */
const TRACES_SINCE = '2026-11-01T00:00:00Z'
const PAGE_LIMIT = 1000

export class LangfuseApiError extends Error {
  readonly status: number

  constructor(status: number, path: string) {
    // Só o caminho e o status: o corpo pode repetir dados do trace.
    super(`Langfuse respondeu ${String(status)} em ${path}`)
    this.name = 'LangfuseApiError'
    this.status = status
  }
}

type Query = Readonly<Record<string, string>>

function createLangfuseApi(config: LangfuseApiConfig) {
  let origin = config.baseUrl
  while (origin.endsWith('/')) {
    origin = origin.slice(0, -1)
  }
  const doFetch = config.fetch ?? fetch
  const authorization = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    options: { readonly body?: unknown; readonly query?: Query } = {},
  ): Promise<unknown> {
    const url = new URL(`${origin}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }
    const response = await doFetch(url, {
      method,
      headers: {
        authorization,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new LangfuseApiError(response.status, path)
    }
    const text = await response.text()
    return text === '' ? null : (JSON.parse(text) as unknown)
  }

  return { request }
}

type LangfuseApi = ReturnType<typeof createLangfuseApi>

interface Page<T> {
  readonly data?: readonly T[]
  readonly meta?: { readonly cursor?: string | null; readonly totalPages?: number }
}

/**
 * Score `user_feedback` no trace (id estável por pergunta: trocar o polegar no mesmo dia substitui
 * o score) e, no 👎, o trace na annotation queue. A queue é achada pelo nome uma vez por instância.
 */
export function createLangfuseFeedback(config: LangfuseApiConfig): TraceFeedbackPort {
  const api = createLangfuseApi(config)
  let queueId: string | null = null

  async function feedbackQueue(): Promise<string> {
    if (queueId !== null) {
      return queueId
    }
    const page = (await api.request('GET', '/api/public/annotation-queues', {
      query: { limit: '100' },
    })) as Page<{ readonly id: string; readonly name: string }> | null
    const queue = (page?.data ?? []).find((candidate) => candidate.name === FEEDBACK_QUEUE_NAME)
    if (queue === undefined) {
      throw new Error(`annotation queue ${FEEDBACK_QUEUE_NAME} não existe no projeto`)
    }
    queueId = queue.id
    return queue.id
  }

  return {
    async recordFeedback(feedback: TraceFeedback) {
      await api.request('POST', '/api/public/scores', {
        body: {
          id: `${feedback.questionId}-${FEEDBACK_SCORE_NAME}`,
          traceId: feedback.traceId,
          name: FEEDBACK_SCORE_NAME,
          value: feedback.rating === 'up' ? 1 : 0,
          dataType: 'BOOLEAN',
          ...(config.environment === undefined ? {} : { environment: config.environment }),
          ...(feedback.reason === null ? {} : { comment: feedback.reason }),
        },
      })
      if (feedback.rating === 'down') {
        await api.request('POST', `/api/public/annotation-queues/${await feedbackQueue()}/items`, {
          body: { objectId: feedback.traceId, objectType: 'TRACE' },
        })
      }
    },
  }
}

/** Ids dos traces do usuário (observations raiz com o `userId` em hash), página a página. */
async function traceIdsOf(api: LangfuseApi, userId: string): Promise<string[]> {
  const ids = new Set<string>()
  let cursor: string | null = null
  do {
    const page = (await api.request('GET', '/api/public/v2/observations', {
      query: {
        userId: langfuseUserId(userId),
        fromStartTime: TRACES_SINCE,
        fields: 'core',
        limit: String(PAGE_LIMIT),
        ...(cursor === null ? {} : { cursor }),
      },
    })) as Page<{ readonly traceId?: string | null }> | null
    for (const observation of page?.data ?? []) {
      if (typeof observation.traceId === 'string' && observation.traceId !== '') {
        ids.add(observation.traceId)
      }
    }
    cursor = page?.meta?.cursor ?? null
  } while (cursor !== null)
  return [...ids]
}

/**
 * Apagamento dos traces do usuário no Langfuse (`DeleteMyData`, tarefa pós-resposta): acha os
 * traces pelo `userId` em hash e os apaga em lotes de até 1.000 (observations e scores saem
 * junto). Uma falha fica no log para o tratamento manual, dentro do SLA de 15 dias.
 */
export function createLangfuseErasure(config: LangfuseApiConfig): ErasurePort {
  const api = createLangfuseApi(config)
  return {
    name: 'langfuse',
    async eraseUser(userId) {
      const ids = await traceIdsOf(api, userId)
      for (let start = 0; start < ids.length; start += DELETE_BATCH) {
        await api.request('DELETE', '/api/public/traces', {
          body: { traceIds: ids.slice(start, start + DELETE_BATCH) },
        })
      }
    },
  }
}
