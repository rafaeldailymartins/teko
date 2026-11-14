import sensible from '@fastify/sensible'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerProblemHandlers } from '../problem/error-handler.ts'
import { registerOriginGuard } from './origin-guard.ts'

const ORIGIN = 'https://tekoia-staging.vercel.app'
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }

const apps: FastifyInstance[] = []

async function build(): Promise<FastifyInstance> {
  const app = Fastify()
  apps.push(app)
  registerProblemHandlers(app)
  await app.register(sensible)
  registerOriginGuard(app, { webOrigin: ORIGIN })
  app.post('/api/v1/things', async () => ({ ok: true }))
  app.delete('/api/v1/things', async () => ({ ok: true }))
  app.get('/api/v1/things', async () => ({ ok: true }))
  app.post('/api/auth/sign-in/social', async () => ({ ok: true }))
  return app
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('registerOriginGuard', () => {
  it('aceita a mutação da própria origem com JSON', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      headers: JSON_HEADERS,
      payload: '{}',
    })
    expect(response.statusCode).toBe(200)
  })

  it.each([
    ['sem Origin', { 'content-type': 'application/json' }],
    [
      'Origin de outro site',
      { origin: 'https://evil.example', 'content-type': 'application/json' },
    ],
    ['Origin "null"', { origin: 'null', 'content-type': 'application/json' }],
    ['Origin com barra final', { origin: `${ORIGIN}/`, 'content-type': 'application/json' }],
  ])('%s → 403 forbidden', async (_name, headers) => {
    const app = await build()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      headers,
      payload: '{}',
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ code: 'forbidden' })
  })

  it('DELETE também exige Origin, mas não corpo JSON', async () => {
    const app = await build()
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/things' })).statusCode).toBe(403)
    const ok = await app.inject({
      method: 'DELETE',
      url: '/api/v1/things',
      headers: { origin: ORIGIN },
    })
    expect(ok.statusCode).toBe(200)
  })

  it('POST sem JSON → 415 validation_error', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      headers: { origin: ORIGIN, 'content-type': 'text/plain' },
      payload: 'x',
    })
    expect(response.statusCode).toBe(415)
    expect(response.json()).toMatchObject({ code: 'validation_error', status: 415 })
  })

  it('aceita parâmetros no content-type JSON', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things',
      headers: { origin: ORIGIN, 'content-type': 'Application/JSON; charset=utf-8' },
      payload: '{}',
    })
    expect(response.statusCode).toBe(200)
  })

  it('query string numa mutação → 400 validation_error', async () => {
    const app = await build()
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/things?question=cpf',
      headers: JSON_HEADERS,
      payload: '{}',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ code: 'validation_error' })
  })

  it('não toca GET; no Better Auth exige Origin, mas aceita query string', async () => {
    const app = await build()
    expect((await app.inject({ method: 'GET', url: '/api/v1/things?x=1' })).statusCode).toBe(200)
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(foreign.statusCode).toBe(403)
    const own = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social?disableRedirect=true',
      headers: JSON_HEADERS,
      payload: '{}',
    })
    expect(own.statusCode).toBe(200)
  })

  it('fora de /api (estático do Plano B) não age', async () => {
    const app = await build()
    app.post('/healthz-like', async () => ({ ok: true }))
    expect((await app.inject({ method: 'POST', url: '/healthz-like' })).statusCode).toBe(200)
  })
})
