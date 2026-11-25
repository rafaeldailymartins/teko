import { APIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'
import { authMethodsOf } from './auth-config.ts'
import {
  createBetterAuthOptions,
  DISABLED_AUTH_PATHS,
  EMAIL_RATE_LIMITS,
  parseSignUpBody,
  SESSION_COOKIE_CACHE_S,
} from './better-auth.ts'

const db = {} as DrizzleDb
const BASE = {
  secret: 'teste'.repeat(8),
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
    expect(options.rateLimit).toMatchObject({ enabled: true, storage: 'database' })
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

  it('e-mail e senha sem confirmação, sem login automático no cadastro e com 12 a 128', () => {
    const { emailAndPassword } = createBetterAuthOptions(db, {
      ...BASE,
      webOrigin: 'https://tekoia.vercel.app',
    })
    expect(emailAndPassword).toEqual({
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    })
  })

  it('não vincula por nome de provedor nem com e-mail diferente', () => {
    const { account } = createBetterAuthOptions(db, { ...BASE, webOrigin: 'http://localhost:3000' })
    expect(account.accountLinking).toEqual({
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
    })
  })

  it('desliga as rotas que mandariam e-mail e aperta o rate limit da entrada e do cadastro', () => {
    const options = createBetterAuthOptions(db, { ...BASE, webOrigin: 'http://localhost:3000' })
    expect(options.disabledPaths).toEqual([...DISABLED_AUTH_PATHS])
    expect(DISABLED_AUTH_PATHS).toEqual(
      expect.arrayContaining(['/request-password-reset', '/reset-password', '/verify-email']),
    )
    expect(options.rateLimit.customRules).toEqual({
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 600, max: 5 },
    })
    expect(options.rateLimit.customRules).toEqual(EMAIL_RATE_LIMITS)
  })
})

describe('authMethodsOf', () => {
  it('lista os OAuth apps configurados, a passkey e o e-mail, nessa ordem', () => {
    expect(authMethodsOf(BASE)).toEqual(['github', 'passkey', 'email'])
    expect(
      authMethodsOf({ github: BASE.github, google: { clientId: 'go', clientSecret: 'gos' } }),
    ).toEqual(['github', 'google', 'passkey', 'email'])
    expect(authMethodsOf({ github: null, google: null })).toEqual(['passkey', 'email'])
  })
})

describe('parseSignUpBody', () => {
  const BODY = { name: '  Ana  ', email: 'ana@example.com', password: 'senha-longa-1' }

  function codeOf(body: unknown): unknown {
    try {
      parseSignUpBody(body)
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      return (error as APIError).body?.code
    }
    throw new Error('parseSignUpBody deveria ter falhado')
  }

  it('apara o nome e mantém a senha', () => {
    expect(parseSignUpBody(BODY)).toEqual({ ...BODY, name: 'Ana' })
  })

  it.each([
    ['senha curta', { password: 'curta' }, 'PASSWORD_TOO_SHORT'],
    ['senha longa', { password: 'a'.repeat(129) }, 'PASSWORD_TOO_LONG'],
    ['senha ausente', { password: undefined }, 'PASSWORD_TOO_SHORT'],
    ['e-mail inválido', { email: 'ana' }, 'INVALID_EMAIL'],
    ['nome vazio', { name: ' ' }, 'INVALID_NAME'],
    ['foto', { image: 'https://evil.example/a.png' }, 'VALIDATION_ERROR'],
  ])('%s dá 400 com %s', (_label, change, code) => {
    expect(codeOf({ ...BODY, ...change })).toBe(code)
  })

  it('corpo que não é objeto dá VALIDATION_ERROR', () => {
    expect(codeOf(null)).toBe('VALIDATION_ERROR')
  })
})
