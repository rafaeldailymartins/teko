import {
  authProvidersResponseSchema,
  meExportSchema,
  meResponseSchema,
} from '@teko/shared/contracts'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Container } from '#app/container.ts'
import { buildApp } from '../../../src/build-app.ts'
import { createContainer, createHttpOptions } from '../../../src/composition-root.ts'
import { type Env, parseEnv } from '../../../src/config/env.ts'
import { FIXTURE_EMBEDDINGS } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Login por e-mail e senha (ADR 0036) com o Better Auth sobre o banco de teste (`teko_app`):
 * cadastro e entrada, erro genérico (nada revela se um e-mail existe), validação do cadastro, rotas
 * de e-mail desligadas, rate limit por IP, a não vinculação entre a conta de senha e um OAuth com o
 * mesmo e-mail (nos dois sentidos, com o GitHub simulado no `fetch`), a exportação e o `DELETE /me`
 * de uma conta de senha, e `GET /api/v1/auth/providers`.
 *
 * Cada caso usa o seu IP (`remoteAddress`), porque o rate limit do Better Auth conta por IP e
 * caminho.
 */

const ORIGIN = 'http://localhost:3000'
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }
const PASSWORD = 'uma senha longa o bastante'

let database: TestDatabase
let env: Env
let container: Container
let app: FastifyInstance
let owner: pg.Client
let nextIp = 1

/** Um IP novo por caso (a janela do rate limit é por IP e caminho). */
function freshIp(): string {
  nextIp += 1
  return `10.20.${String(Math.floor(nextIp / 250))}.${String(nextIp % 250)}`
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@teko.localhost`
}

function post(url: string, payload: unknown, ip: string, cookie?: string) {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...JSON_HEADERS, ...(cookie === undefined ? {} : { cookie }) },
    payload: JSON.stringify(payload),
    remoteAddress: ip,
  })
}

function signUp(body: Record<string, unknown>, ip: string) {
  return post('/api/auth/sign-up/email', body, ip)
}

function signIn(email: string, password: string, ip: string) {
  return post('/api/auth/sign-in/email', { email, password }, ip)
}

/** `nome=valor` de cada `Set-Cookie` com valor (os apagados ficam de fora). */
function cookieOf(res: LightMyRequestResponse): string {
  return [res.headers['set-cookie'] ?? []]
    .flat()
    .map((header) => header.split(';')[0] ?? '')
    .filter((pair) => !pair.endsWith('='))
    .join('; ')
}

async function newPasswordAccount(email: string): Promise<{ userId: string; cookie: string }> {
  const ip = freshIp()
  expect((await signUp({ name: 'Ana', email, password: PASSWORD }, ip)).statusCode).toBe(200)
  const res = await signIn(email, PASSWORD, ip)
  expect(res.statusCode).toBe(200)
  return { userId: res.json<{ user: { id: string } }>().user.id, cookie: cookieOf(res) }
}

async function accountsOf(email: string): Promise<{ provider_id: string; password: string }[]> {
  const { rows } = await owner.query<{ provider_id: string; password: string }>(
    `SELECT a.provider_id, a.password FROM auth.account a JOIN auth."user" u ON u.id = a.user_id
     WHERE u.email = $1 ORDER BY a.provider_id`,
    [email],
  )
  return rows
}

/** GitHub simulado: troca de código e perfil com o e-mail dado (verificado pelo GitHub). */
function stubGitHub(profile: { readonly id: number; readonly email: string }): void {
  const realFetch = globalThis.fetch
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (url === 'https://github.com/login/oauth/access_token') {
      return json({ access_token: 'gho_teste', token_type: 'bearer', scope: 'read:user' })
    }
    if (url === 'https://api.github.com/user/emails') {
      return json([{ email: profile.email, primary: true, verified: true }])
    }
    if (url === 'https://api.github.com/user') {
      return json({ id: profile.id, login: 'ana', name: 'Ana', email: profile.email })
    }
    return realFetch(input, init)
  })
}

/** Entrada pelo GitHub até o callback; devolve a resposta do callback (redirect). */
async function signInWithGitHub(ip: string): Promise<LightMyRequestResponse> {
  const start = await post(
    '/api/auth/sign-in/social',
    { provider: 'github', callbackURL: '/pt-BR/chat/', errorCallbackURL: '/pt-BR/sign-in/' },
    ip,
  )
  expect(start.statusCode).toBe(200)
  const state = new URL(start.json<{ url: string }>().url).searchParams.get('state') ?? ''
  return app.inject({
    url: `/api/auth/callback/github?code=codigo-teste&state=${encodeURIComponent(state)}`,
    headers: { cookie: cookieOf(start) },
    remoteAddress: ip,
  })
}

beforeAll(async () => {
  database = await createTestDatabase()
  env = parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: ORIGIN,
    DATABASE_URL: database.appUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
    BETTER_AUTH_SECRET: 'teste'.repeat(8),
    GITHUB_CLIENT_ID: 'gh-client-id',
    GITHUB_CLIENT_SECRET: 'gh-client-secret',
  })
  container = createContainer(env, { applicationName: 'teko-test' })
  app = await buildApp({ container, http: createHttpOptions(env, container.rateLimitStore) })
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
}, 120_000)

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await app?.close()
  await container?.close()
  await owner?.end()
  await database?.drop()
})

describe('cadastro e entrada', () => {
  it('o cadastro não abre sessão; a entrada abre, e o /me pede o onboarding', async () => {
    const email = uniqueEmail('ana').toUpperCase()
    const ip = freshIp()
    const created = await signUp({ name: '  Ana Souza  ', email, password: PASSWORD }, ip)
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ token: null, user: { name: 'Ana Souza' } })
    expect(cookieOf(created)).toBe('')

    // O e-mail é gravado em minúsculas e entra com qualquer caixa.
    const res = await signIn(email.toLowerCase(), PASSWORD, ip)
    expect(res.statusCode).toBe(200)
    const cookie = cookieOf(res)
    expect(cookie).toContain('teko-stg.session_token=')
    const me = meResponseSchema.parse(
      (await app.inject({ url: '/api/v1/me', headers: { cookie } })).json(),
    )
    expect(me).toMatchObject({ email: email.toLowerCase(), onboarding: { required: true } })

    const [account] = await accountsOf(email.toLowerCase())
    expect(account?.provider_id).toBe('credential')
    // Hash do Better Auth (scrypt, `sal:chave` em hex), nunca a senha.
    expect(account?.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)
    const { rows } = await owner.query<{ email_verified: boolean }>(
      'SELECT email_verified FROM auth."user" WHERE email = $1',
      [email.toLowerCase()],
    )
    expect(rows).toEqual([{ email_verified: false }])
  })

  it('o cadastro de um e-mail que já existe responde igual e não muda nada', async () => {
    const email = uniqueEmail('dupla')
    const { userId } = await newPasswordAccount(email)
    const [before] = await accountsOf(email)

    const ip = freshIp()
    const fresh = await signUp(
      { name: 'Outra', email: uniqueEmail('nova'), password: PASSWORD },
      ip,
    )
    const again = await signUp({ name: 'Outra', email, password: 'outra senha qualquer' }, ip)
    expect(again.statusCode).toBe(fresh.statusCode)
    expect(Object.keys(again.json()).sort()).toEqual(Object.keys(fresh.json()).sort())
    expect(again.json()).toMatchObject({ token: null, user: { email } })
    expect(again.json<{ user: { id: string } }>().user.id).not.toBe(userId)
    expect(await accountsOf(email)).toEqual([before])

    // A senha antiga continua valendo, e a nova não entra.
    expect((await signIn(email, PASSWORD, ip)).statusCode).toBe(200)
    expect((await signIn(email, 'outra senha qualquer', freshIp())).statusCode).toBe(401)
  })

  it('senha errada e e-mail inexistente dão o mesmo 401', async () => {
    const email = uniqueEmail('erro')
    await newPasswordAccount(email)
    const ip = freshIp()
    const wrong = await signIn(email, 'senha errada qualquer', ip)
    const unknown = await signIn(uniqueEmail('ninguem'), 'senha errada qualquer', ip)
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json()).toEqual(unknown.json())
    expect(wrong.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect(cookieOf(wrong)).toBe('')
  })

  it.each([
    ['senha curta', { password: 'a'.repeat(11) }, 'PASSWORD_TOO_SHORT'],
    ['senha longa', { password: 'a'.repeat(129) }, 'PASSWORD_TOO_LONG'],
    ['nome em branco', { name: '   ' }, 'INVALID_NAME'],
    ['e-mail inválido', { email: 'ana' }, 'INVALID_EMAIL'],
    ['foto', { image: 'https://evil.example/a.png' }, 'VALIDATION_ERROR'],
    ['campo do onboarding', { termsVersion: '2026-11-16' }, 'VALIDATION_ERROR'],
  ])('recusa o cadastro com %s', async (_label, change, code) => {
    const email = uniqueEmail('invalido')
    const res = await signUp({ name: 'Ana', email, password: PASSWORD, ...change }, freshIp())
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code })
    expect(await accountsOf(email)).toEqual([])
  })

  it('recusa o cadastro vindo de outra origem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { name: 'Ana', email: uniqueEmail('origem'), password: PASSWORD },
      remoteAddress: freshIp(),
    })
    expect(res.statusCode).toBe(403)
  })

  it.each(['/api/auth/request-password-reset', '/api/auth/send-verification-email'])(
    '%s não existe (sem recuperação nem confirmação por e-mail)',
    async (url) => {
      const res = await post(url, { email: uniqueEmail('rota') }, freshIp())
      expect(res.statusCode).toBe(404)
    },
  )
})

describe('rate limit do Better Auth', () => {
  it('a sexta entrada do mesmo IP no minuto dá 429', async () => {
    const ip = freshIp()
    const email = uniqueEmail('forca')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn(email, 'senha errada qualquer', ip)).statusCode).toBe(401)
    }
    const blocked = await signIn(email, 'senha errada qualquer', ip)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['x-retry-after']).toBeDefined()
    // Outro IP continua entrando.
    expect((await signIn(email, 'senha errada qualquer', freshIp())).statusCode).toBe(401)
  })

  it('o sexto cadastro do mesmo IP em 10 min dá 429', async () => {
    const ip = freshIp()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const res = await signUp({ name: 'Ana', email: uniqueEmail('lote'), password: PASSWORD }, ip)
      expect(res.statusCode).toBe(200)
    }
    const blocked = await signUp(
      { name: 'Ana', email: uniqueEmail('lote'), password: PASSWORD },
      ip,
    )
    expect(blocked.statusCode).toBe(429)
  })
})

describe('contas separadas por método', () => {
  it('o GitHub com o e-mail de uma conta de senha não vincula nem entra nela', async () => {
    const email = uniqueEmail('senha-primeiro')
    const { userId } = await newPasswordAccount(email)
    stubGitHub({ id: 101, email })

    const callback = await signInWithGitHub(freshIp())
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toContain('/pt-BR/sign-in/')
    expect(callback.headers.location).toContain('error=account_not_linked')
    expect(cookieOf(callback)).not.toContain('session_token')

    expect((await accountsOf(email)).map((row) => row.provider_id)).toEqual(['credential'])
    const { rows } = await owner.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM auth.session WHERE user_id = $1',
      [userId],
    )
    expect(rows[0]?.total).toBe(1)
  })

  it('a senha cadastrada com o e-mail de uma conta do GitHub não entra nela', async () => {
    const email = uniqueEmail('github-primeiro')
    stubGitHub({ id: 202, email })
    const callback = await signInWithGitHub(freshIp())
    expect(callback.statusCode).toBe(302)
    expect(callback.headers.location).toContain('/pt-BR/chat/')
    expect(cookieOf(callback)).toContain('session_token')

    const ip = freshIp()
    const created = await signUp({ name: 'Intrusa', email, password: PASSWORD }, ip)
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ token: null })
    const res = await signIn(email, PASSWORD, ip)
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'INVALID_EMAIL_OR_PASSWORD' })
    expect((await accountsOf(email)).map((row) => row.provider_id)).toEqual(['github'])
  })
})

describe('direitos do titular com conta de senha', () => {
  it('a exportação lista a conta como email, sem o hash', async () => {
    const email = uniqueEmail('exporta')
    const { cookie } = await newPasswordAccount(email)
    const [account] = await accountsOf(email)
    const res = await app.inject({ url: '/api/v1/me/export', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(meExportSchema.parse(res.json()).linkedAccounts).toEqual(['email'])
    expect(res.body).not.toContain(account?.password ?? 'sem-hash')
    expect(res.body).not.toContain(PASSWORD)
  })

  it('DELETE /me apaga a conta de senha, e a mesma senha não entra mais', async () => {
    const email = uniqueEmail('apaga')
    const { cookie, userId } = await newPasswordAccount(email)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie, origin: ORIGIN },
    })
    expect(res.statusCode).toBe(204)
    const { rows } = await owner.query<{ users: number; accounts: number }>(
      `SELECT (SELECT count(*) FROM auth."user" WHERE id = $1)::int AS users,
              (SELECT count(*) FROM auth.account WHERE user_id = $1)::int AS accounts`,
      [userId],
    )
    expect(rows[0]).toEqual({ users: 0, accounts: 0 })
    expect((await signIn(email, PASSWORD, freshIp())).statusCode).toBe(401)
  })
})

describe('GET /api/v1/auth/providers', () => {
  it('lista os métodos ativos, sem cache e sem sessão', async () => {
    const res = await app.inject({ url: '/api/v1/auth/providers' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(authProvidersResponseSchema.parse(res.json())).toEqual({
      methods: ['github', 'passkey', 'email'],
    })
  })
})
