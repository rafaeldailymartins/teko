import { describe, expect, it } from 'vitest'
import { buildApp, fastifyTrustProxy } from './build-app.ts'
import { createContainer, createHttpOptions } from './composition-root.ts'
import { parseEnv } from './config/env.ts'

describe('fastifyTrustProxy', () => {
  it('repassa booleano e lista (cópia mutável)', () => {
    const list = ['172.30.0.0/24'] as const
    expect(fastifyTrustProxy(false)).toBe(false)
    expect(fastifyTrustProxy(list)).toEqual(['172.30.0.0/24'])
  })

  it('converte número de saltos na função equivalente do proxy-addr', () => {
    const trust = fastifyTrustProxy(1)
    if (typeof trust !== 'function') {
      throw new Error('deveria ser função')
    }
    expect(trust('127.0.0.1', 0)).toBe(true)
    expect(trust('198.51.100.5', 1)).toBe(false)
  })
})

describe('buildApp', () => {
  it('registra o rate limit só quando há store compartilhado', async () => {
    const env = parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'https://tekoia-staging.vercel.app' })
    const app = await buildApp({
      container: createContainer(env),
      http: {
        ...createHttpOptions(env),
        rateLimit: {
          store: { hit: async () => ({ count: 1, resetInMs: 60_000 }) },
          max: 10,
          timeWindowMs: 60_000,
        },
      },
    })
    expect(app.hasDecorator('rateLimit')).toBe(true)
    await app.close()
  })

  it('recusa as rotas de eval fora de APP_ENV=ci', async () => {
    const env = parseEnv({ APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' })
    await expect(
      buildApp({
        container: createContainer(env),
        http: { ...createHttpOptions(env), evalRoutes: true },
      }),
    ).rejects.toThrow('rotas /api/v1/_eval/* proibidas com APP_ENV=development')
  })

  it('só registra as rotas de eval com APP_ENV=ci', async () => {
    const ci = parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'http://localhost:3000' })
    const dev = parseEnv({ APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' })
    expect(createHttpOptions(ci).evalRoutes).toBe(true)
    expect(createHttpOptions(dev).evalRoutes).toBe(false)
    const app = await buildApp({ container: createContainer(ci), http: createHttpOptions(ci) })
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/_eval/search?question=x&referenceDate=2024-01-01&source=explicit',
    })
    // Sem banco: a rota existe e responde 503 (`service_paused`), não 404.
    expect(response.statusCode).toBe(503)
    await app.close()
  })
})
