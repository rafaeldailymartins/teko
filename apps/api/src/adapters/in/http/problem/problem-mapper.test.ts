import { isProblemDetails, problemTypeUri } from '@teko/shared/errors'
import { ResponseSerializationError, validatorCompiler } from 'fastify-type-provider-zod'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { instancePathToFieldPath, notFoundProblem, problemFromError } from './problem-mapper.ts'

const context = { traceId: 'req-12345678', instance: '/api/v1/questions' } as const

/** Reproduz o erro que o Fastify monta a partir do validator real do type provider. */
function zodValidationError(
  schema: z.ZodType,
  data: unknown,
  validationContext: string | undefined,
): Error {
  const validate = validatorCompiler({ schema, method: 'POST', url: '/x', httpPart: 'body' })
  const result = validate(data)
  if (typeof result !== 'object' || !('error' in result)) {
    throw new Error('o validator deveria ter falhado')
  }
  return Object.assign(new Error('validation failed'), {
    statusCode: 400,
    code: 'FST_ERR_VALIDATION',
    validation: result.error,
    validationContext,
  })
}

interface HttpErrorExtra {
  readonly message?: unknown
  readonly code?: string
  readonly expose?: boolean
}

function httpError(statusCode: number, extra: HttpErrorExtra = {}): Error {
  const message = typeof extra.message === 'string' ? extra.message : 'boom'
  return Object.assign(new Error(message), { statusCode, ...extra })
}

describe('instancePathToFieldPath', () => {
  it.each([
    ['', ''],
    ['/question', 'question'],
    ['/families/0', 'families.0'],
    ['/a~1b/c~0d', 'a/b.c~d'],
  ])('%j → %j', (input, expected) => {
    expect(instancePathToFieldPath(input)).toBe(expected)
  })
})

describe('problemFromError', () => {
  it('converte erros de validação Zod em validation_error com errors[] por campo', () => {
    const schema = z.strictObject({ question: z.string(), families: z.array(z.string()) })
    const error = zodValidationError(schema, { families: [1], extra: true }, 'body')

    const problem = problemFromError(error, context)

    expect(problem).toMatchObject({
      code: 'validation_error',
      status: 400,
      detail: 'Invalid body',
      traceId: 'req-12345678',
      instance: '/api/v1/questions',
    })
    expect(problem.code === 'validation_error' && problem.errors?.map((e) => e.path)).toEqual([
      'question',
      'families.0',
      '',
    ])
    expect(isProblemDetails(problem)).toBe(true)
  })

  it('validação sem contexto conhecido é descrita como "request"', () => {
    const error = zodValidationError(z.strictObject({}), { x: 1 }, undefined)
    expect(problemFromError(error, context).detail).toBe('Invalid request')
  })

  it('erro de serialização de resposta é bug nosso: 500 internal, sem detalhes', () => {
    const parsed = z.object({ ok: z.literal(true) }).safeParse({ ok: false })
    if (parsed.success) {
      throw new Error('o parse deveria falhar')
    }
    const error = new ResponseSerializationError('GET', '/x', { cause: parsed.error })
    expect(problemFromError(error, context)).toEqual({
      type: problemTypeUri('internal'),
      title: 'Internal error',
      status: 500,
      code: 'internal',
      traceId: 'req-12345678',
      instance: '/api/v1/questions',
    })
  })

  it.each([
    [new Error('segredo do banco'), 'internal', 500],
    ['string lançada', 'internal', 500],
    [null, 'internal', 500],
    [httpError(500), 'internal', 500],
    [httpError(502), 'internal', 500],
    [httpError(302), 'internal', 500],
    [httpError(503), 'service_paused', 503],
    [httpError(401), 'unauthenticated', 401],
    [httpError(403), 'forbidden', 403],
    [httpError(404), 'not_found', 404],
    [httpError(451), 'region_restricted', 451],
    [httpError(429), 'rate_limited', 429],
    [httpError(413, { code: 'FST_ERR_CTP_BODY_TOO_LARGE' }), 'validation_error', 413],
    [httpError(415, { code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' }), 'validation_error', 415],
    [httpError(405), 'validation_error', 405],
  ])('%o → %s (%i)', (error, code, status) => {
    const problem = problemFromError(error, context)
    expect(problem.code).toBe(code)
    expect(problem.status).toBe(status)
    expect(isProblemDetails(problem)).toBe(true)
  })

  it('nunca vaza a mensagem de erros 5xx ou desconhecidos', () => {
    expect(problemFromError(new Error('senha=123'), context).detail).toBeUndefined()
    expect(
      problemFromError(httpError(500, { message: 'senha=123', expose: true }), context).detail,
    ).toBeUndefined()
  })

  it('usa a mensagem como detail só para erros do Fastify ou http-errors com expose', () => {
    expect(
      problemFromError(
        httpError(413, {
          code: 'FST_ERR_CTP_BODY_TOO_LARGE',
          message: 'Request body is too large',
        }),
        context,
      ).detail,
    ).toBe('Request body is too large')
    expect(
      problemFromError(httpError(403, { message: 'Sem assinatura', expose: true }), context).detail,
    ).toBe('Sem assinatura')
    expect(problemFromError(httpError(400, { message: 'interno' }), context).detail).toBeUndefined()
    expect(
      problemFromError(httpError(400, { code: 'FST_X', message: '   ' }), context).detail,
    ).toBeUndefined()
    expect(
      problemFromError(httpError(400, { code: 'FST_X', message: 42 }), context).detail,
    ).toBeUndefined()
  })

  it('429 explica o Retry-After', () => {
    expect(problemFromError(httpError(429), context).detail).toMatch(/Retry-After/)
  })

  it('omite instance quando o contexto não tem caminho', () => {
    expect(problemFromError(httpError(404), { traceId: 't-12345678' })).not.toHaveProperty(
      'instance',
    )
  })

  it('ignora statusCode não inteiro', () => {
    expect(problemFromError(httpError(404.5), context).code).toBe('internal')
  })
})

describe('notFoundProblem', () => {
  it('descreve a rota inexistente', () => {
    expect(notFoundProblem('GET', { traceId: 't-12345678', instance: '/nada' })).toEqual({
      type: problemTypeUri('not_found'),
      title: 'Not found',
      status: 404,
      code: 'not_found',
      traceId: 't-12345678',
      instance: '/nada',
      detail: 'Route GET /nada not found',
    })
  })

  it('funciona sem instance', () => {
    expect(notFoundProblem('POST', { traceId: 't-12345678' }).detail).toBe('Route POST  not found')
  })
})
