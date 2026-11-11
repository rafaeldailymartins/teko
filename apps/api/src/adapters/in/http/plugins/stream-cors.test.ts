import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { STREAM_CORS_MAX_AGE_SECONDS, STREAM_PREFIX, streamScope } from './stream-cors.ts'

const WEB_ORIGIN = 'https://tekoia.netlify.app'
const STREAM_URL = '/api/v1/questions/0b9f5b0e-3f43-4c62-9f7e-0d1c2b3a4f5e/stream'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  await app.register(streamScope, { prefix: STREAM_PREFIX, webOrigin: WEB_ORIGIN })
  app.get('/api/healthz', async () => ({ ok: true }))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

function preflight(origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: STREAM_URL,
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type',
    },
  })
}

describe('streamScope (CORS do stream)', () => {
  it('libera o preflight só para a origem exata da web', async () => {
    const res = await preflight(WEB_ORIGIN)
    expect(res.statusCode).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(WEB_ORIGIN)
    expect(res.headers['access-control-allow-methods']).toBe('POST')
    expect(res.headers['access-control-allow-headers']).toBe(
      'authorization, content-type, traceparent, tracestate, baggage, sentry-trace',
    )
    expect(res.headers['access-control-max-age']).toBe(String(STREAM_CORS_MAX_AGE_SECONDS))
    expect(res.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it.each([
    'https://evil.example',
    'https://tekoia.netlify.app.evil.example',
    'http://tekoia.netlify.app',
  ])('não libera a origem %s', async (origin) => {
    const res = await preflight(origin)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('não adiciona CORS fora do escopo do stream', async () => {
    const res = await app.inject({ url: '/api/healthz', headers: { origin: WEB_ORIGIN } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
