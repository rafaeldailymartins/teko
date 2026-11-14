import { describe, expect, it } from 'vitest'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'
import { createBetterAuthOptions, SESSION_COOKIE_CACHE_S } from './better-auth.ts'

const db = {} as DrizzleDb
const BASE = {
  secret: 'segredo-de-teste-com-mais-de-32-caracteres',
  cookiePrefix: 'teko',
  github: { clientId: 'gh', clientSecret: 'ghs' },
  google: null,
} as const

describe('createBetterAuthOptions', () => {
  it('na origem https usa cookies __Secure-, o rpID do host e só os OAuth apps configurados', () => {
    const options = createBetterAuthOptions(db, { ...BASE, webOrigin: 'https://tekoia.vercel.app' })
    expect(options.baseURL).toBe('https://tekoia.vercel.app')
    expect(options.basePath).toBe('/api/auth')
    expect(options.trustedOrigins).toEqual(['https://tekoia.vercel.app'])
    expect(options.advanced.useSecureCookies).toBe(true)
    expect(options.advanced.cookiePrefix).toBe('teko')
    expect(options.advanced.database.generateId).toBe('uuid')
    expect(Object.keys(options.socialProviders)).toEqual(['github'])
    expect(options.session.cookieCache).toEqual({ enabled: true, maxAge: SESSION_COOKIE_CACHE_S })
    expect(options.rateLimit).toEqual({ enabled: true, storage: 'database' })
    expect(options.telemetry).toEqual({ enabled: false })
    expect(options.plugins.map((plugin) => plugin.id)).toEqual(['passkey'])
  })

  it('em http local não usa o prefixo seguro', () => {
    const options = createBetterAuthOptions(db, {
      ...BASE,
      webOrigin: 'http://localhost:3000',
      github: null,
      google: { clientId: 'go', clientSecret: 'gos' },
    })
    expect(options.advanced.useSecureCookies).toBe(false)
    expect(Object.keys(options.socialProviders)).toEqual(['google'])
  })
})
