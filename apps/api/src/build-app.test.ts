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
    const env = parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'https://develop--teko-web.netlify.app' })
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
})
