import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthGateway, AuthSession } from '#app/ports/auth-gateway.ts'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'

const SESSION: AuthSession = {
  sessionId: 's1',
  expiresAt: new Date('2026-12-01T00:00:00Z'),
  user: {
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.com',
    image: null,
    isAdult: true,
    termsVersion: '1',
    termsAcceptedAt: null,
    countryOfResidence: 'BR',
  },
}

const real = vi.hoisted(() => ({
  createBetterAuthGateway: vi.fn(),
}))

vi.mock('./better-auth.ts', () => real)

const { createLazyBetterAuthGateway } = await import('./lazy-better-auth.ts')

const CONFIG = {
  secret: 'teste'.repeat(8),
  webOrigin: 'https://tekoia.vercel.app',
  cookiePrefix: 'teko',
  github: { clientId: 'gh', clientSecret: 'ghs' },
  google: null,
} as const

const db = {} as DrizzleDb

beforeEach(() => {
  real.createBetterAuthGateway.mockReset()
  real.createBetterAuthGateway.mockImplementation(
    (): AuthGateway => ({
      methods: [],
      clearSessionCookies: () => [],
      handle: async () => new Response('ok', { status: 200 }),
      getSession: async () => SESSION,
    }),
  )
})

describe('createLazyBetterAuthGateway', () => {
  it('responde métodos e cookies de saída sem carregar o Better Auth', () => {
    const gateway = createLazyBetterAuthGateway(db, CONFIG)

    expect(gateway.methods).toEqual(['github', 'passkey', 'email'])
    expect(gateway.clearSessionCookies()).toEqual([
      '__Secure-teko.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      '__Secure-teko.session_data=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
      '__Secure-teko.dont_remember=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure',
    ])
    expect(real.createBetterAuthGateway).not.toHaveBeenCalled()
  })

  it('instancia o Better Auth uma vez, no primeiro handle ou getSession, e delega', async () => {
    const gateway = createLazyBetterAuthGateway(db, CONFIG)
    const headers = new Headers({ cookie: 'teko.session_token=x' })

    const [session, response] = await Promise.all([
      gateway.getSession(headers, { fresh: true }),
      gateway.handle(new Request('https://tekoia.vercel.app/api/auth/ok')),
    ])
    await gateway.getSession(headers)

    expect(session).toBe(SESSION)
    expect(response.status).toBe(200)
    expect(real.createBetterAuthGateway).toHaveBeenCalledTimes(1)
    expect(real.createBetterAuthGateway).toHaveBeenCalledWith(db, CONFIG)
  })

  it('preload carrega antes da primeira requisição, e ela reaproveita a mesma instância', async () => {
    const gateway = createLazyBetterAuthGateway(db, CONFIG)

    await gateway.preload()
    expect(real.createBetterAuthGateway).toHaveBeenCalledTimes(1)
    await gateway.getSession(new Headers())
    expect(real.createBetterAuthGateway).toHaveBeenCalledTimes(1)
  })
})
