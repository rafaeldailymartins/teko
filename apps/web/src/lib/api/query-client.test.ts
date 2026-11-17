import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import { ApiError } from './errors.ts'
import {
  createQueryClient,
  isUnexpectedApiError,
  STALE_TIME_MS,
  shouldRetry,
} from './query-client.ts'

const apiError = (code: ErrorCode) => new ApiError({ code, status: null })

describe('createQueryClient', () => {
  it('staleTime de 60 s nas consultas e mutações sem retry', () => {
    const defaults = createQueryClient().getDefaultOptions()
    expect(STALE_TIME_MS).toBe(60_000)
    expect(defaults.queries?.staleTime).toBe(60_000)
    expect(defaults.queries?.retry).toBe(shouldRetry)
    expect(defaults.mutations?.retry).toBe(false)
  })
})

describe('erros inesperados ao Error Tracking (ADR 0037)', () => {
  const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
  const internal = new ApiError({ code: ErrorCode.Internal, status: 500, traceId: TRACE_ID })

  it('só o 500 internal que a API devolveu', () => {
    expect(isUnexpectedApiError(internal)).toBe(true)
    expect(isUnexpectedApiError(apiError(ErrorCode.Internal))).toBe(false)
    expect(isUnexpectedApiError(new ApiError({ code: ErrorCode.ServicePaused, status: 503 }))).toBe(
      false,
    )
    expect(isUnexpectedApiError(new ApiError({ code: ErrorCode.NotFound, status: 404 }))).toBe(
      false,
    )
    expect(isUnexpectedApiError(new Error('x'))).toBe(false)
  })

  it('consulta e mutação que falham com 500 vão ao destino; as esperadas, não', async () => {
    const reported: unknown[] = []
    const client = createQueryClient((error) => reported.push(error))
    await client
      .fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(internal), retry: false })
      .catch(() => {})
    await client
      .fetchQuery({
        queryKey: ['y'],
        queryFn: () => Promise.reject(new ApiError({ code: ErrorCode.NotFound, status: 404 })),
        retry: false,
      })
      .catch(() => {})
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(internal),
    })
    await mutation.execute(undefined).catch(() => {})
    expect(reported).toEqual([internal, internal])
  })
})

describe('shouldRetry', () => {
  it('repete erro transitório até duas vezes', () => {
    expect(shouldRetry(0, apiError(ErrorCode.Internal))).toBe(true)
    expect(shouldRetry(1, apiError(ErrorCode.UpstreamUnavailable))).toBe(true)
    expect(shouldRetry(2, apiError(ErrorCode.ServicePaused))).toBe(false)
  })

  it('não repete erro definitivo, cota nem rate limit', () => {
    expect(shouldRetry(0, apiError(ErrorCode.Unauthenticated))).toBe(false)
    expect(shouldRetry(0, apiError(ErrorCode.NotFound))).toBe(false)
    expect(shouldRetry(0, apiError(ErrorCode.QuotaExceeded))).toBe(false)
    expect(shouldRetry(0, apiError(ErrorCode.RateLimited))).toBe(false)
  })

  it('não repete o que não é ApiError', () => {
    expect(shouldRetry(0, new Error('outro'))).toBe(false)
  })
})
