import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  API_CACHE_CONTROL,
  registerApiCacheControl,
  registerSecurityHeaders,
} from './security-headers.ts'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  await registerSecurityHeaders(app)
  registerApiCacheControl(app)
  for (const url of ['/healthz', '/api', '/api/healthz', '/apiary']) {
    app.get(url, async () => ({ ok: true }))
  }
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('registerSecurityHeaders', () => {
  it("aplica CSP default-src 'none' e os headers do helmet", async () => {
    const res = await app.inject({ url: '/healthz' })
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'",
    )
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toEqual(expect.stringContaining('max-age='))
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('registerApiCacheControl', () => {
  it.each(['/api', '/api/healthz'])(
    'marca %s como private, no-store e Vary: Cookie',
    async (url) => {
      const res = await app.inject({ url })
      expect(res.headers['cache-control']).toBe(API_CACHE_CONTROL)
      expect(res.headers.vary).toContain('Cookie')
      expect(res.headers.etag).toBeUndefined()
    },
  )

  it.each(['/healthz', '/apiary'])('não mexe em %s (fora de /api/*)', async (url) => {
    const res = await app.inject({ url })
    expect(res.headers['cache-control']).toBeUndefined()
  })
})
