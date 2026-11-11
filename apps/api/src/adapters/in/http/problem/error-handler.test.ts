import { isProblemDetails, PROBLEM_CONTENT_TYPE } from '@teko/shared/errors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { registerProblemHandlers } from './error-handler.ts'

let app: FastifyInstance

beforeEach(async () => {
  app = Fastify({ bodyLimit: 64, genReqId: () => 'trace-00000001' })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  registerProblemHandlers(app)

  const typed = app.withTypeProvider<ZodTypeProvider>()
  typed.post(
    '/echo',
    { schema: { body: z.strictObject({ name: z.string().min(1) }) } },
    async (req) => ({
      name: req.body.name,
    }),
  )
  typed.get('/boom', async () => {
    throw new Error('connection string postgres://user:secret@host')
  })
  typed.get(
    '/bad-response',
    { schema: { response: { 200: z.object({ ok: z.literal(true) }) } } },
    // Simula um bug: o handler devolve algo fora do schema de resposta.
    async () => JSON.parse('{"ok":false}') as { ok: true },
  )
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe('registerProblemHandlers', () => {
  it('responde 404 de rota inexistente como problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/nada?x=1' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE)
    expect(res.json()).toMatchObject({
      code: 'not_found',
      status: 404,
      traceId: 'trace-00000001',
      instance: '/nada',
      detail: 'Route GET /nada not found',
    })
  })

  it('validação Zod do corpo vira 400 validation_error com errors[]', async () => {
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { name: '', extra: 1 } })
    expect(res.statusCode).toBe(400)
    const body: unknown = res.json()
    expect(isProblemDetails(body)).toBe(true)
    expect(body).toMatchObject({ code: 'validation_error', detail: 'Invalid body' })
    const { errors } = z.object({ errors: z.array(z.object({ path: z.string() })) }).parse(body)
    expect(errors.map((e) => e.path).sort()).toEqual(['', 'name'])
  })

  it('JSON malformado vira 400 validation_error com a mensagem do Fastify', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      code: 'validation_error',
      status: 400,
      detail: expect.any(String),
    })
  })

  it('corpo acima do bodyLimit vira 413 validation_error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { name: 'x'.repeat(100) },
    })
    expect(res.statusCode).toBe(413)
    expect(res.json()).toMatchObject({ code: 'validation_error', status: 413 })
  })

  it('content-type não suportado vira 415 validation_error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/xml' },
      payload: '<name/>',
    })
    expect(res.statusCode).toBe(415)
    expect(res.json()).toMatchObject({ code: 'validation_error', status: 415 })
  })

  it('erro inesperado vira 500 internal sem vazar a mensagem', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('secret')
    expect(res.json()).toEqual({
      type: 'tag:teko-api.vercel.app,2026:problems/internal',
      title: 'Internal error',
      status: 500,
      code: 'internal',
      traceId: 'trace-00000001',
      instance: '/boom',
    })
  })

  it('resposta fora do schema vira 500 internal', async () => {
    const res = await app.inject({ method: 'GET', url: '/bad-response' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toMatchObject({ code: 'internal' })
  })
})
