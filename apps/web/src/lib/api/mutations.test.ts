import { skipToken } from '@tanstack/react-query'
import { createProblem, ErrorCode } from '@teko/shared/errors'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { QUESTION_ID, questionDetail } from '../../../test/chat-fixtures.ts'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'
import { rereadQuestion, submitFeedback } from './mutations.ts'
import { quotaQuery } from './queries.ts'

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
