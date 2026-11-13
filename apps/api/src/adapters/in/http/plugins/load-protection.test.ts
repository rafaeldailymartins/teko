import Fastify, { type FastifyInstance } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { ClientIp, ClientIpInput } from '#app/ports/client-ip.ts'
import type { RateLimitHit, RateLimitStore } from '#app/ports/rate-limit-store.ts'
import { createContainer } from '../../../../composition-root.ts'
import { parseEnv } from '../../../../config/env.ts'
import { registerProblemHandlers } from '../problem/error-handler.ts'
import { decorateContainer } from './container.ts'
import { rateLimitNamespace, registerRateLimit, registerUnderPressure } from './load-protection.ts'

/** Store de janela fixa em memória: só para teste (em produção, o store é o Postgres). */
class FakeStore implements RateLimitStore {
  readonly keys: string[] = []
  readonly #counts = new Map<string, number>()

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    this.keys.push(key)
    const count = (this.#counts.get(key) ?? 0) + 1
    this.#counts.set(key, count)
    return { count, resetInMs: windowMs }
  }
}

const failingStore = (reason: unknown): RateLimitStore => ({
  hit: () => Promise.reject(reason),
})

function fixedClientIp(ip: string | null): ClientIp & { readonly inputs: ClientIpInput[] } {
  const inputs: ClientIpInput[] = []
  return {
    inputs,
    resolve(input) {
      inputs.push(input)
      return ip === null ? { ip: null, source: 'none' } : { ip, source: 'platform' }
    },
  }
}

async function appWith(store: RateLimitStore, clientIp: ClientIp): Promise<FastifyInstance> {
  const base = createContainer(
    parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'https://tekoia-staging.vercel.app' }),
  )
  const app = Fastify()
  registerProblemHandlers(app)
  decorateContainer(app, { ...base, clientIp })
  await registerRateLimit(app, { store, max: 2, timeWindowMs: 60_000 })
  app.get('/limited', { config: { rateLimit: {} } }, async () => ({ ok: true }))
  app.get('/other', { config: { rateLimit: {} } }, async () => ({ ok: true }))
  app.get('/grouped', { config: { rateLimit: { groupId: 'mutations' } } }, async () => ({
    ok: true,
  }))
  app.get('/free', async () => ({ ok: true }))
  return app
}

describe('registerRateLimit', () => {
  it('só limita rotas que optam, com problem+json rate_limited e Retry-After', async () => {
    const store = new FakeStore()
    const app = await appWith(store, fixedClientIp('203.0.113.7'))

    expect((await app.inject({ url: '/limited' })).statusCode).toBe(200)
    expect((await app.inject({ url: '/limited' })).statusCode).toBe(200)
    const limited = await app.inject({ url: '/limited' })

    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBe('60')
    expect(limited.headers['content-type']).toContain('application/problem+json')
    expect(limited.json()).toMatchObject({ status: 429, code: 'rate_limited' })

    // Outra rota tem o próprio contador; rota sem `config.rateLimit` não é limitada.
    expect((await app.inject({ url: '/other' })).statusCode).toBe(200)
    for (let i = 0; i < 5; i += 1) {
      expect((await app.inject({ url: '/free' })).statusCode).toBe(200)
    }
    expect(new Set(store.keys)).toEqual(
      new Set(['GET /limited|ip:203.0.113.7', 'GET /other|ip:203.0.113.7']),
    )
    await app.close()
  })

  it('usa o groupId como namespace e a porta ClientIp', async () => {
    const store = new FakeStore()
    const clientIp = fixedClientIp('2001:db8::1')
    const app = await appWith(store, clientIp)

    await app.inject({ url: '/grouped', headers: { 'x-real-ip': '198.51.100.1' } })

    // O plugin acrescenta o groupId à chave; o namespace só separa rotas agrupadas das demais.
    expect(store.keys).toEqual(['group|ip:2001:db8::1mutations'])
    expect(clientIp.inputs[0]).toMatchObject({
      forwardedIp: '127.0.0.1',
      headers: { 'x-real-ip': '198.51.100.1' },
    })
    await app.close()
  })

  it('sem IP confiável, cai no IP do socket', async () => {
    const store = new FakeStore()
    const app = await appWith(store, fixedClientIp(null))
    await app.inject({ url: '/limited' })
    expect(store.keys).toEqual(['GET /limited|socket:127.0.0.1'])
    await app.close()
  })

  it.each([[new Error('db down')], ['rejeição sem Error']])(
    'falha do store vira 500 internal sem vazar detalhes (%o)',
    async (reason) => {
      const app = await appWith(failingStore(reason), fixedClientIp('203.0.113.7'))
      const res = await app.inject({ url: '/limited' })
      expect(res.statusCode).toBe(500)
      expect(res.json()).toMatchObject({ code: 'internal' })
      expect(res.json()).not.toHaveProperty('detail')
      await app.close()
    },
  )
})

describe('rateLimitNamespace', () => {
  it.each([
    [{ groupId: 'g1', routeInfo: { method: 'GET', url: '/x' } }, 'group'],
    [{ routeInfo: { method: 'POST', url: '/api/v1/questions' } }, 'POST /api/v1/questions'],
    [{ routeInfo: { method: ['GET', 'HEAD'], url: '/x' } }, 'GET,HEAD /x'],
    [{ routeInfo: { url: '/x' } }, '/x'],
    [{ routeInfo: {} }, 'global'],
    [{}, 'global'],
    [null, 'global'],
    ['texto', 'global'],
  ])('%j → %s', (params, expected) => {
    expect(rateLimitNamespace(params)).toBe(expected)
  })
})

describe('registerUnderPressure', () => {
  it('não interfere com o processo saudável e não expõe rota de status', async () => {
    const app = Fastify()
    await registerUnderPressure(app, { eventLoopDelayGuard: true })
    app.get('/ok', async () => ({ ok: true }))

    expect((await app.inject({ url: '/ok' })).statusCode).toBe(200)
    expect(app.hasRoute({ method: 'GET', url: '/status' })).toBe(false)
    expect(app.memoryUsage()).toHaveProperty('eventLoopDelay')
    await app.close()
  })

  it.each([
    [true, 1000],
    [false, 0],
  ] as const)(
    'eventLoopDelayGuard %s → maxEventLoopDelay %d (0 desliga no plugin)',
    async (eventLoopDelayGuard, expected) => {
      const app = Fastify()
      const register = vi.spyOn(app, 'register')
      await registerUnderPressure(app, { eventLoopDelayGuard })
      expect(register).toHaveBeenCalledWith(expect.any(Function), {
        maxEventLoopDelay: expected,
        exposeStatusRoute: false,
      })
      await app.close()
    },
  )
})
