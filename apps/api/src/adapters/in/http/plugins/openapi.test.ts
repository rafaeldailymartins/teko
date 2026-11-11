import Fastify, { type FastifyInstance } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DOCS_CONTENT_SECURITY_POLICY,
  DOCS_JSON_PATH,
  DOCS_PREFIX,
  registerOpenApi,
} from './openapi.ts'
import { registerSecurityHeaders } from './security-headers.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await registerSecurityHeaders(app)
  await registerOpenApi(app, { version: '1.2.3' })
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/api/ping',
      { schema: { operationId: 'ping', response: { 200: z.object({ pong: z.literal(true) }) } } },
      async () => ({ pong: true as const }),
    )
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('registerOpenApi', () => {
  it('publica o OpenAPI 3.1 gerado dos schemas Zod em /api/docs/json', async () => {
    const res = await app.inject({ url: DOCS_JSON_PATH })
    expect(res.statusCode).toBe(200)
    const document: unknown = res.json()
    expect(document).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Tekó API', version: '1.2.3' },
      paths: {
        '/api/ping': {
          get: {
            operationId: 'ping',
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { pong: { type: 'boolean', enum: [true] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const paths = Object.keys(
      z.object({ paths: z.record(z.string(), z.unknown()) }).parse(document).paths,
    )
    expect(paths.some((path) => path.startsWith(DOCS_PREFIX))).toBe(false)
  })

  it('serve a referência Scalar com a CSP relaxada só nas rotas de documentação', async () => {
    const page = await app.inject({ url: `${DOCS_PREFIX}/` })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.headers['content-security-policy']).toBe(DOCS_CONTENT_SECURITY_POLICY)

    const api = await app.inject({ url: '/api/ping' })
    expect(api.headers['content-security-policy']).toContain("default-src 'none'")
  })
})
