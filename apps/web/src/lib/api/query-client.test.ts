import { ErrorCode } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import { ApiError } from './errors.ts'
import { createQueryClient, STALE_TIME_MS, shouldRetry } from './query-client.ts'

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
