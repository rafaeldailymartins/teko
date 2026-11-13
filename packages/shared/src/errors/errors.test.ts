import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createProblem,
  ERROR_CODE_SPECS,
  ERROR_CODES,
  ErrorCode,
  httpStatusOf,
  isErrorCode,
  isProblemDetails,
  isRetryable,
  PROBLEM_CONTENT_TYPE,
  problemDetailsSchema,
  problemTypeUri,
  toFieldErrors,
} from './index.ts'

describe('códigos de erro', () => {
  it('é um conjunto fechado com os códigos do plano', () => {
    expect(ERROR_CODES).toEqual([
      'validation_error',
      'unauthenticated',
      'forbidden',
      'not_found',
      'onboarding_required',
      'quota_exceeded',
      'rate_limited',
      'service_paused',
      'stream_busy',
      'upstream_unavailable',
      'region_restricted',
      'internal',
    ])
    expect(Object.keys(ERROR_CODE_SPECS).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('mapeia status HTTP do plano', () => {
    expect(httpStatusOf(ErrorCode.ValidationError)).toBe(400)
    expect(httpStatusOf(ErrorCode.StreamBusy)).toBe(409)
    expect(httpStatusOf(ErrorCode.QuotaExceeded)).toBe(429)
    expect(httpStatusOf(ErrorCode.RateLimited)).toBe(429)
    expect(httpStatusOf(ErrorCode.ServicePaused)).toBe(503)
    for (const code of ERROR_CODES) {
      expect(httpStatusOf(code)).toBeGreaterThanOrEqual(400)
      expect(httpStatusOf(code)).toBeLessThan(600)
    }
  })

  it('indica quais erros podem ser repetidos', () => {
    expect(isRetryable(ErrorCode.UpstreamUnavailable)).toBe(true)
    expect(isRetryable(ErrorCode.Forbidden)).toBe(false)
    expect(isRetryable(ErrorCode.RateLimited)).toBe(true)
  })

  it('reconhece códigos válidos', () => {
    expect(isErrorCode('stream_busy')).toBe(true)
    expect(isErrorCode('toString')).toBe(false)
    expect(isErrorCode('teapot')).toBe(false)
    expect(isErrorCode(42)).toBe(false)
  })
})

describe('createProblem', () => {
  it('deriva type, title e status do código', () => {
    const problem = createProblem({
      code: ErrorCode.StreamBusy,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      instance: '/api/v1/questions/0192/stream',
    })
    expect(problem).toEqual({
      type: 'tag:teko-api.vercel.app,2026:problems/stream_busy',
      title: 'Another answer is already streaming',
      status: 409,
      code: 'stream_busy',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      instance: '/api/v1/questions/0192/stream',
    })
    expect(problemTypeUri(ErrorCode.Internal)).toBe(
      'tag:teko-api.vercel.app,2026:problems/internal',
    )
    expect(PROBLEM_CONTENT_TYPE).toBe('application/problem+json')
  })

  it('exige meta.scope em quota_exceeded', () => {
    const problem = createProblem({
      code: ErrorCode.QuotaExceeded,
      traceId: 't1',
      meta: { scope: 'user_daily', resetAt: '2026-11-11T03:00:00Z' },
    })
    expect(problem.status).toBe(429)
    expect(
      problemDetailsSchema.safeParse({ ...problem, meta: { scope: 'monthly', resetAt: 'x' } })
        .success,
    ).toBe(false)
    expect(problemDetailsSchema.safeParse({ ...problem, meta: undefined }).success).toBe(false)
  })

  it('carrega erros de campo em validation_error e aceita status sobrescrito', () => {
    const problem = createProblem({
      code: ErrorCode.ValidationError,
      traceId: 't2',
      status: 415,
      detail: 'content-type deve ser application/json',
      errors: [{ path: 'question', message: 'Obrigatório' }],
    })
    expect(problem).toMatchObject({ status: 415, errors: [{ path: 'question' }] })
  })

  it('rate_limited não exige meta (não é a cota diária)', () => {
    const problem = createProblem({ code: ErrorCode.RateLimited, traceId: 't3' })
    expect(problem).toEqual({
      type: 'tag:teko-api.vercel.app,2026:problems/rate_limited',
      title: 'Too many requests',
      status: 429,
      code: 'rate_limited',
      traceId: 't3',
    })
    expect(isProblemDetails(problem)).toBe(true)
  })

  it('rejeita status fora de 4xx/5xx e traceId vazio', () => {
    expect(() => createProblem({ code: ErrorCode.Internal, traceId: 't', status: 200 })).toThrow()
    expect(() => createProblem({ code: ErrorCode.Internal, traceId: '' })).toThrow()
  })

  it('reconhece problem+json válidos', () => {
    expect(isProblemDetails(createProblem({ code: ErrorCode.NotFound, traceId: 't' }))).toBe(true)
    expect(isProblemDetails({ status: 404 })).toBe(false)
    expect(
      isProblemDetails({ type: 'x', title: 'x', status: 404, code: 'teapot', traceId: 't' }),
    ).toBe(false)
  })
})

describe('toFieldErrors', () => {
  it('converte issues do Zod em caminhos com pontos', () => {
    const schema = z.object({ families: z.array(z.string()), question: z.string() })
    const result = schema.safeParse({ families: ['ok', 1] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(toFieldErrors(result.error).map((e) => e.path)).toEqual(['families.1', 'question'])
    }
  })
})
