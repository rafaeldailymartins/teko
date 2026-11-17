import { describe, expect, it } from 'vitest'
import { createLangfuseErasure, createLangfuseFeedback, LangfuseApiError } from './langfuse-api.ts'
import { FEEDBACK_QUEUE_NAME } from './langfuse-names.ts'
import { langfuseUserId } from './langfuse-user.ts'

interface Call {
  readonly method: string
  readonly url: URL
  readonly body: unknown
  readonly authorization: string | null
}

/** `fetch` falso: responde pela rota (`MÉTODO /caminho`) e grava as chamadas. */
function fakeFetch(routes: Record<string, (url: URL) => { status?: number; body?: unknown }>) {
  const calls: Call[] = []
  const doFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    calls.push({
      method,
      url,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      authorization: headers.get('authorization'),
    })
    const route = routes[`${method} ${url.pathname}`]
    const response = route?.(url) ?? { status: 404 }
    return new Response(response.body === undefined ? '' : JSON.stringify(response.body), {
      status: response.status ?? 200,
    })
  }) as typeof fetch
  return { doFetch, calls }
}

const CONFIG = {
  baseUrl: 'https://cloud.langfuse.com/',
  publicKey: 'pk-lf-a',
  secretKey: 'sk-lf-b',
}

const QUEUES = {
  'GET /api/public/annotation-queues': () => ({
    body: {
      data: [
        { id: 'outra', name: 'x' },
        { id: 'queue-1', name: FEEDBACK_QUEUE_NAME },
      ],
    },
  }),
  'POST /api/public/scores': () => ({ body: { id: 's' } }),
  'POST /api/public/annotation-queues/queue-1/items': () => ({ body: { id: 'i' } }),
}

describe('createLangfuseFeedback', () => {
  it('👍: score BOOLEAN 1 com id estável, basic auth, sem annotation queue', async () => {
    const { doFetch, calls } = fakeFetch(QUEUES)
    await createLangfuseFeedback({ ...CONFIG, fetch: doFetch }).recordFeedback({
      traceId: 't1',
      questionId: 'q1',
      rating: 'up',
      reason: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url.href).toBe('https://cloud.langfuse.com/api/public/scores')
    expect(calls[0]?.authorization).toBe(
      `Basic ${Buffer.from('pk-lf-a:sk-lf-b').toString('base64')}`,
    )
    expect(calls[0]?.body).toEqual({
      id: 'q1-user_feedback',
      traceId: 't1',
      name: 'user_feedback',
      value: 1,
      dataType: 'BOOLEAN',
    })
  })

  it('👎: score 0 com o motivo e o trace na annotation queue (achada uma vez)', async () => {
    const { doFetch, calls } = fakeFetch(QUEUES)
    const port = createLangfuseFeedback({ ...CONFIG, fetch: doFetch })
    const down = { traceId: 't1', questionId: 'q1', rating: 'down', reason: 'outdated' } as const
    await port.recordFeedback(down)
    await port.recordFeedback({ ...down, traceId: 't2', questionId: 'q2' })
    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      'POST /api/public/scores',
      'GET /api/public/annotation-queues',
      'POST /api/public/annotation-queues/queue-1/items',
      'POST /api/public/scores',
      'POST /api/public/annotation-queues/queue-1/items',
    ])
    expect(calls[0]?.body).toMatchObject({ value: 0, comment: 'outdated' })
    expect(calls[2]?.body).toEqual({ objectId: 't1', objectType: 'TRACE' })
  })

  it('sem a queue no projeto, ou com erro da API, rejeita sem repetir o corpo', async () => {
    const empty = fakeFetch({
      ...QUEUES,
      'GET /api/public/annotation-queues': () => ({ body: { data: [] } }),
    })
    await expect(
      createLangfuseFeedback({ ...CONFIG, fetch: empty.doFetch }).recordFeedback({
        traceId: 't',
        questionId: 'q',
        rating: 'down',
        reason: null,
      }),
    ).rejects.toThrow(FEEDBACK_QUEUE_NAME)
    const failing = fakeFetch({
      'POST /api/public/scores': () => ({ status: 401, body: { message: 'segredo' } }),
    })
    const error = await createLangfuseFeedback({ ...CONFIG, fetch: failing.doFetch })
      .recordFeedback({ traceId: 't', questionId: 'q', rating: 'up', reason: null })
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(LangfuseApiError)
    expect((error as LangfuseApiError).status).toBe(401)
    expect((error as Error).message).not.toContain('segredo')
  })
})

describe('createLangfuseErasure', () => {
  it('acha os traces pelo userId em hash, segue o cursor e apaga em lote', async () => {
    const pages: Record<string, unknown> = {
      first: {
        data: [{ traceId: 'a' }, { traceId: 'b' }, { traceId: 'a' }],
        meta: { cursor: 'c2' },
      },
      c2: { data: [{ traceId: 'c' }, { traceId: null }], meta: { cursor: null } },
    }
    const { doFetch, calls } = fakeFetch({
      'GET /api/public/v2/observations': (url) => ({
        body: pages[url.searchParams.get('cursor') ?? 'first'],
      }),
      'DELETE /api/public/traces': () => ({ body: {} }),
    })
    const erasure = createLangfuseErasure({ ...CONFIG, fetch: doFetch })
    expect(erasure.name).toBe('langfuse')
    await erasure.eraseUser('u1')
    const reads = calls.filter((call) => call.method === 'GET')
    expect(reads).toHaveLength(2)
    expect(reads[0]?.url.searchParams.get('userId')).toBe(langfuseUserId('u1'))
    expect(reads[0]?.url.searchParams.get('fields')).toBe('core')
    expect(reads[1]?.url.searchParams.get('cursor')).toBe('c2')
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.body)).toEqual([
      { traceIds: ['a', 'b', 'c'] },
    ])
  })

  it('usuário sem traces: nada a apagar', async () => {
    const { doFetch, calls } = fakeFetch({
      'GET /api/public/v2/observations': () => ({ body: { data: [], meta: {} } }),
    })
    await createLangfuseErasure({ ...CONFIG, fetch: doFetch }).eraseUser('u1')
    expect(calls.map((call) => call.method)).toEqual(['GET'])
  })
})
