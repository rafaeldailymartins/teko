import { createProblem, ERROR_CODES, ErrorCode, isRetryable } from '@teko/shared/errors'
import { describe, expect, it } from 'vitest'
import en from '../../../messages/en.json'
import ptBR from '../../../messages/pt-BR.json'
import { ApiError, errorCodeForStatus, toApiError } from './errors.ts'

function response(status: number): Response {
  return new Response(null, { status })
}

describe('toApiError', () => {
  it('lê code, traceId e retryable de um problem+json', () => {
    const problem = createProblem({ code: ErrorCode.ServicePaused, traceId: 'trace-1' })
    const error = toApiError(problem, response(503))
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      code: 'service_paused',
      status: 503,
      retryable: true,
      traceId: 'trace-1',
      quota: null,
      problem,
    })
    expect(error.message).toBe('Service paused')
  })

  it('expõe escopo e reset de quota_exceeded', () => {
    const meta = { scope: 'user_daily', resetAt: '2026-11-16T03:00:00.000Z' } as const
    const problem = createProblem({ code: ErrorCode.QuotaExceeded, traceId: 't', meta })
    const error = toApiError(problem, response(429))
    expect(error.code).toBe('quota_exceeded')
    expect(error.quota).toEqual(meta)
  })

  it('usa o detail do problem como mensagem quando existe', () => {
    const problem = createProblem({
      code: ErrorCode.NotFound,
      traceId: 't',
      detail: 'Sem pergunta',
    })
    expect(toApiError(problem, response(404)).message).toBe('Sem pergunta')
  })

  it('sem problem+json válido, o código sai do status HTTP', () => {
    const error = toApiError('<html>Bad Gateway</html>', response(502))
    expect(error).toMatchObject({ code: 'internal', status: 502, traceId: null, problem: null })
    expect(error.cause).toBe('<html>Bad Gateway</html>')
    expect(toApiError({ code: 'inventado' }, response(401)).code).toBe('unauthenticated')
  })

  it('falha de rede (sem resposta) é internal, repetível e sem status', () => {
    const cause = new TypeError('fetch failed')
    const error = toApiError(cause, undefined)
    expect(error).toMatchObject({ code: 'internal', status: null, retryable: true, cause })
  })

  it('não embrulha duas vezes', () => {
    const error = new ApiError({ code: ErrorCode.Forbidden, status: 403 })
    expect(toApiError(error, response(403))).toBe(error)
  })
})

describe('errorCodeForStatus', () => {
  it.each([
    [400, 'validation_error'],
    [413, 'validation_error'],
    [415, 'validation_error'],
    [422, 'validation_error'],
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'stream_busy'],
    [429, 'rate_limited'],
    [451, 'region_restricted'],
    [503, 'service_paused'],
    [500, 'internal'],
    [502, 'internal'],
  ] as const)('%i vira %s', (status, code) => {
    expect(errorCodeForStatus(status)).toBe(code)
  })
})

describe('ApiError', () => {
  it.each(ERROR_CODES)(
    '%s: retryable do shared e mensagem errors.<code> nos dois idiomas',
    (code) => {
      const error = new ApiError({ code, status: null })
      expect(error.retryable).toBe(isRetryable(code))
      expect(error.messageKey).toBe(`errors.${code}`)
      for (const catalog of [en, ptBR]) {
        const errors: Record<string, string> = catalog.errors
        expect(errors[code], `${code} sem mensagem`).toBeTypeOf('string')
      }
    },
  )

  it('é um Error com nome próprio', () => {
    const error = new ApiError({ code: ErrorCode.Internal, status: 500 })
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ApiError')
  })
})
