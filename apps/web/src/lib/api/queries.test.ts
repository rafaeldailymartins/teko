import { QueryClient, skipToken } from '@tanstack/react-query'
import { createProblem, ErrorCode } from '@teko/shared/errors'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'
import {
  coverageQuery,
  historyQuery,
  meQuery,
  provisionDiffQuery,
  provisionSearchQuery,
  provisionTimelineQuery,
  questionQuery,
} from './queries.ts'
import { createQueryClient } from './query-client.ts'

/**
 * Camada de dados de ponta a ponta sem rede: `fetch` simulado, cliente gerado, interceptor de erro
 * e QueryClient. O Node não aceita URL relativa em `Request`, então os testes trocam o `baseUrl`
 * por uma origem absoluta (o padrão `/api` é conferido antes).
 */

const ORIGIN = 'http://teko.test'
const ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b'

type Handler = (request: Request) => Response | Promise<Response>

const requests: Request[] = []

function mockFetch(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      requests.push(request)
      return handler(request)
    }),
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  })
}

function lastUrl(): URL {
  const request = requests.at(-1)
  if (request === undefined) {
    throw new Error('nenhuma requisição')
  }
  return new URL(request.url)
}

/** Sem retry: os testes de erro não esperam o backoff. */
function noRetryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

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

describe('apiClient', () => {
  it('chama a API na mesma origem, sob /api', () => {
    expect(defaultBaseUrl).toBe('/api')
  })
})

describe('consultas', () => {
  it('meQuery lê GET /api/v1/me', async () => {
    const me = { id: ID, name: 'Ana', email: 'ana@example.com', image: null }
    mockFetch(() => json(me))
    await expect(noRetryClient().fetchQuery(meQuery())).resolves.toEqual(me)
    expect(lastUrl().href).toBe(`${ORIGIN}/api/v1/me`)
    expect(requests[0]?.method).toBe('GET')
  })

  it('coverageQuery lê GET /api/v1/coverage', async () => {
    mockFetch(() => json({ corpusVersion: 3, families: [] }))
    await expect(noRetryClient().fetchQuery(coverageQuery())).resolves.toEqual({
      corpusVersion: 3,
      families: [],
    })
    expect(lastUrl().pathname).toBe('/api/v1/coverage')
  })

  it('historyQuery lista a conversa e fica parada sem conversationId', async () => {
    expect(historyQuery(null).queryFn).toBe(skipToken)
    mockFetch(() => json({ items: [] }))
    await noRetryClient().fetchQuery(historyQuery(ID))
    expect(lastUrl().pathname).toBe('/api/v1/questions')
    expect(lastUrl().searchParams.get('conversationId')).toBe(ID)
  })

  it('questionQuery lê a pergunta pelo id e fica parada sem id', async () => {
    expect(questionQuery(null).queryFn).toBe(skipToken)
    mockFetch(() => json({ id: ID }))
    await noRetryClient().fetchQuery(questionQuery(ID))
    expect(lastUrl().pathname).toBe(`/api/v1/questions/${ID}`)
  })

  it('provisionTimelineQuery lê a linha do tempo do dispositivo', async () => {
    expect(provisionTimelineQuery(null).queryFn).toBe(skipToken)
    mockFetch(() => json({ stableKey: 'rcte:art-76', versions: [] }))
    await noRetryClient().fetchQuery(provisionTimelineQuery('rcte:art-76'))
    expect(lastUrl().pathname).toBe('/api/v1/provisions/rcte%3Aart-76/timeline')
  })

  it('provisionDiffQuery manda as datas efetivas das duas referências', async () => {
    const from = { periodoApuracao: '2008-05' } as const
    const to = { referenceDate: '2010-01-15' } as const
    expect(provisionDiffQuery(null, from, to).queryFn).toBe(skipToken)
    mockFetch(() => json({ stableKey: 'rcte:art-76', segments: [] }))
    await noRetryClient().fetchQuery(provisionDiffQuery('rcte:art-76', from, to))
    expect(lastUrl().pathname).toBe('/api/v1/provisions/rcte%3Aart-76/diff')
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
      from: '2008-05-01',
      to: '2010-01-15',
    })
  })

  it('provisionSearchQuery manda sempre a data em at e pede 2 caracteres', async () => {
    expect(provisionSearchQuery(' a ', { periodoApuracao: '2024-03' }).queryFn).toBe(skipToken)
    mockFetch(() => json({ at: '2024-03-01', items: [] }))
    await noRetryClient().fetchQuery(
      provisionSearchQuery(' art. 76 ', { periodoApuracao: '2024-03' }),
    )
    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({ q: 'art. 76', at: '2024-03-01' })
  })
})

describe('query keys com a data de referência', () => {
  it('período e dia 1 do mês dividem a entrada; outra data é outra entrada', () => {
    const march = provisionSearchQuery('art. 76', { periodoApuracao: '2024-03' }).queryKey
    const marchFirst = provisionSearchQuery('art. 76', { referenceDate: '2024-03-01' }).queryKey
    const april = provisionSearchQuery('art. 76', { periodoApuracao: '2024-04' }).queryKey
    expect(march).toEqual(marchFirst)
    expect(march).not.toEqual(april)
    expect(march[0].query).toEqual({ q: 'art. 76', at: '2024-03-01' })
  })

  it('consultas sem data de referência não a carregam na key', () => {
    expect(coverageQuery().queryKey[0]).not.toHaveProperty('query')
    expect(meQuery().queryKey[0]._id).toBe('getMe')
  })
})

describe('erros', () => {
  it('problem+json vira ApiError com code e traceId', async () => {
    mockFetch(() =>
      json(createProblem({ code: ErrorCode.Unauthenticated, traceId: 'trace-9' }), 401),
    )
    const failure = createQueryClient().fetchQuery(meQuery())
    await expect(failure).rejects.toBeInstanceOf(ApiError)
    await expect(failure).rejects.toMatchObject({
      code: 'unauthenticated',
      status: 401,
      traceId: 'trace-9',
      retryable: false,
    })
  })

  it('resposta de erro sem problem+json vira ApiError pelo status', async () => {
    mockFetch(() => new Response('Not Found', { status: 404 }))
    await expect(noRetryClient().fetchQuery(questionQuery(ID))).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    })
  })

  it('falha de rede vira ApiError internal sem status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(noRetryClient().fetchQuery(coverageQuery())).rejects.toMatchObject({
      code: 'internal',
      status: null,
      retryable: true,
    })
  })
})
