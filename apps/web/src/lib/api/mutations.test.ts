import { skipToken } from '@tanstack/react-query'
import { createProblem, ErrorCode } from '@teko/shared/errors'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONVERSATION_ID, QUESTION_ID, questionDetail } from '../../../test/chat-fixtures.ts'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'
import { removeConversation, rereadQuestion, submitFeedback } from './mutations.ts'
import {
  conversationsQuery,
  forgetConversation,
  historyQuery,
  questionQuery,
  quotaQuery,
} from './queries.ts'
import { createQueryClient } from './query-client.ts'

const ORIGIN = 'http://teko.test'
const requests: Request[] = []

function mockFetch(response: () => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request)
      return response()
    }),
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  })

let defaultBaseUrl: string | undefined

beforeAll(() => {
  defaultBaseUrl = apiClient.getConfig().baseUrl
  apiClient.setConfig({ baseUrl: `${ORIGIN}/api` })
})

afterEach(() => {
  vi.unstubAllGlobals()
  requests.length = 0
})

afterAll(() => {
  apiClient.setConfig({ baseUrl: defaultBaseUrl ?? '/api' })
})

describe('submitFeedback', () => {
  it('manda o polegar (e o motivo) para POST /questions/:id/feedback', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await submitFeedback({ questionId: QUESTION_ID, rating: 'up' })
    await submitFeedback({ questionId: QUESTION_ID, rating: 'down', reason: 'wrong_citation' })
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(
      `/api/v1/questions/${QUESTION_ID}/feedback`,
    )
    expect(await requests[0]?.json()).toEqual({ rating: 'up' })
    expect(await requests[1]?.json()).toEqual({ rating: 'down', reason: 'wrong_citation' })
  })

  it('falha com ApiError', async () => {
    mockFetch(() => json(createProblem({ code: ErrorCode.NotFound, traceId: 't' }), 404))
    await expect(submitFeedback({ questionId: QUESTION_ID, rating: 'up' })).rejects.toBeInstanceOf(
      ApiError,
    )
  })
})

describe('removeConversation', () => {
  it('manda DELETE /conversations/:id, sem corpo', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await removeConversation(CONVERSATION_ID)
    expect(requests[0]?.method).toBe('DELETE')
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(
      `/api/v1/conversations/${CONVERSATION_ID}`,
    )
  })

  it('404 conta como excluída; 409 stream_busy chega como ApiError', async () => {
    mockFetch(() => json(createProblem({ code: ErrorCode.NotFound, traceId: 't' }), 404))
    await expect(removeConversation(CONVERSATION_ID)).resolves.toBeUndefined()
    mockFetch(() => json(createProblem({ code: ErrorCode.StreamBusy, traceId: 't' }), 409))
    await expect(removeConversation(CONVERSATION_ID)).rejects.toMatchObject({
      code: 'stream_busy',
      status: 409,
    })
  })
})

describe('forgetConversation', () => {
  const OTHER_CONVERSATION = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7d'
  const OTHER_QUESTION = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7e'
  const PENDING_QUESTION = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7f'

  it('tira a conversa da lista na hora, esquece histórico e perguntas e não toca na cota', async () => {
    // A releitura da lista (invalidação) volta só com a outra conversa.
    mockFetch(() => json({ items: [{ conversationId: OTHER_CONVERSATION }], nextCursor: null }))
    const client = createQueryClient()
    const listKey = conversationsQuery().queryKey
    const summary = (conversationId: string) => ({ conversationId }) as never
    client.setQueryData(listKey, {
      pages: [{ items: [summary(CONVERSATION_ID), summary(OTHER_CONVERSATION)], nextCursor: null }],
      pageParams: [{}],
    })
    client.setQueryData(historyQuery(CONVERSATION_ID).queryKey, {
      items: [questionDetail(), { ...questionDetail(), id: PENDING_QUESTION }] as never,
    })
    client.setQueryData(questionQuery(QUESTION_ID).queryKey, questionDetail() as never)
    client.setQueryData(questionQuery(OTHER_QUESTION).queryKey, {
      ...questionDetail(),
      id: OTHER_QUESTION,
      conversationId: OTHER_CONVERSATION,
    } as never)
    // Sem a resposta gravada no cache: sai pelo id que o histórico listou.
    client.setQueryData(questionQuery(PENDING_QUESTION).queryKey, { id: PENDING_QUESTION } as never)
    client.setQueryData(quotaQuery().queryKey, { day: '2026-11-16' } as never)

    const forgetting = forgetConversation(client, CONVERSATION_ID)
    expect(
      client
        .getQueryData(listKey)
        ?.pages.flatMap((page) => page.items.map((item) => item.conversationId)),
    ).toEqual([OTHER_CONVERSATION])
    await forgetting

    expect(client.getQueryData(historyQuery(CONVERSATION_ID).queryKey)).toBeUndefined()
    expect(client.getQueryData(questionQuery(QUESTION_ID).queryKey)).toBeUndefined()
    expect(client.getQueryData(questionQuery(PENDING_QUESTION).queryKey)).toBeUndefined()
    expect(client.getQueryData(questionQuery(OTHER_QUESTION).queryKey)).toBeDefined()
    expect(client.getQueryState(quotaQuery().queryKey)?.isInvalidated).toBe(false)
    expect(client.getQueryData(quotaQuery().queryKey)).toEqual({ day: '2026-11-16' })
  })
})

describe('rereadQuestion', () => {
  it('relê GET /questions/:id', async () => {
    mockFetch(() => json(questionDetail()))
    await expect(rereadQuestion(QUESTION_ID)).resolves.toMatchObject({ status: 'answered' })
    expect(new URL(requests[0]?.url ?? '').pathname).toBe(`/api/v1/questions/${QUESTION_ID}`)
  })
})

describe('quotaQuery', () => {
  it('lê GET /me/quota e fica parada quando desligada', async () => {
    expect(quotaQuery(false).queryFn).toBe(skipToken)
    const queryFn = quotaQuery().queryFn
    if (typeof queryFn !== 'function') throw new Error('sem queryFn')
    mockFetch(() => json({ day: '2026-11-15' }))
    await queryFn({
      queryKey: quotaQuery().queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    } as never)
    expect(new URL(requests[0]?.url ?? '').pathname).toBe('/api/v1/me/quota')
  })
})
