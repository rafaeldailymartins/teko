import { meResponseSchema } from '@teko/shared/contracts'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Container } from '#app/container.ts'
import { buildApp } from '../../../src/build-app.ts'
import {
  createContainer,
  createDevSessionSeeder,
  createHttpOptions,
} from '../../../src/composition-root.ts'
import { DEFAULT_TERMS_VERSION, type Env, parseEnv } from '../../../src/config/env.ts'
import { FIXED_NOW, FIXTURE_EMBEDDINGS } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Better Auth na mesma origem, com o adapter `relations-v2` sobre o banco de teste (`teko_app`):
 * sessão semeada pelo `seed-dev-session`, `/api/v1/me`, onboarding, início do OAuth do GitHub,
 * `get-session`, sign-out e a chave do rate limit por usuário.
 */

const ORIGIN = 'http://localhost:3000'
const SECRET = 'teste'.repeat(8)

let database: TestDatabase
let env: Env
let container: Container
let app: FastifyInstance
let owner: pg.Client

async function seedSession(email: string): Promise<{ userId: string; cookie: string }> {
  const seeder = createDevSessionSeeder(env, { now: () => new Date(FIXED_NOW) })
  try {
    const session = await seeder.seed({ email, name: 'Teste', country: 'BR' })
    return { userId: session.userId, cookie: `${session.cookieName}=${session.cookieValue}` }
  } finally {
    await seeder.close()
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  env = parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: ORIGIN,
    DATABASE_URL: database.appUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
    BETTER_AUTH_SECRET: SECRET,
    GITHUB_CLIENT_ID: 'gh-client-id',
    GITHUB_CLIENT_SECRET: 'gh-client-secret',
  })
  container = createContainer(env, { applicationName: 'teko-test' })
  app = await buildApp({ container, http: createHttpOptions(env, container.rateLimitStore) })
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
}, 120_000)

afterAll(async () => {
  await app?.close()
  await container?.close()
  await owner?.end()
  await database?.drop()
})

describe('sessão', () => {
  it('sem cookie, /api/v1/me dá 401 unauthenticated', async () => {
    const res = await app.inject({ url: '/api/v1/me' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toMatchObject({ code: 'unauthenticated' })
  })

  it('com a sessão semeada, /api/v1/me devolve o usuário com onboarding concluído', async () => {
    const { userId, cookie } = await seedSession('dev@teko.localhost')
    expect(cookie.startsWith('teko-stg.session_token=')).toBe(true)
    const res = await app.inject({ url: '/api/v1/me', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const me = meResponseSchema.parse(res.json())
    expect(me).toMatchObject({
      id: userId,
      email: 'dev@teko.localhost',
      onboarding: { required: false, acceptedTermsVersion: DEFAULT_TERMS_VERSION },
    })
  })

  it('o get-session do Better Auth lê a mesma sessão (adapter relations-v2)', async () => {
    const { userId, cookie } = await seedSession('sessao@teko.localhost')
    const res = await app.inject({ url: '/api/auth/get-session', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.json()).toMatchObject({ user: { id: userId, isAdult: true } })
  })

  it('cookie com assinatura errada não autentica', async () => {
    const { cookie } = await seedSession('assinatura@teko.localhost')
    const forged = `${cookie.slice(0, cookie.lastIndexOf('.'))}.YXNzaW5hdHVyYS1mYWxzYQ%3D%3D`
    expect(forged).not.toBe(cookie)
    const res = await app.inject({ url: '/api/v1/me', headers: { cookie: forged } })
    expect(res.statusCode).toBe(401)
  })

  it('o sign-out revoga a sessão', async () => {
    const { cookie } = await seedSession('saida@teko.localhost')
    const out = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(out.statusCode).toBe(200)
    const res = await app.inject({ url: '/api/v1/me', headers: { cookie } })
    expect(res.statusCode).toBe(401)
  })
})

describe('onboarding', () => {
  it('pede o onboarding, recusa termos antigos e conclui com os vigentes', async () => {
    const { userId, cookie } = await seedSession('novo@teko.localhost')
    await owner.query(
      `UPDATE auth."user" SET is_adult = false, terms_version = NULL, country_of_residence = NULL
       WHERE id = $1`,
      [userId],
    )
    const before = meResponseSchema.parse(
      (await app.inject({ url: '/api/v1/me', headers: { cookie } })).json(),
    )
    expect(before.onboarding.required).toBe(true)

    const headers = { cookie, origin: ORIGIN, 'content-type': 'application/json' }
    const old = await app.inject({
      method: 'POST',
      url: '/api/v1/me/onboarding',
      headers,
      payload: { isAdult: true, termsVersion: '2020-01-01', countryOfResidence: 'PT' },
    })
    expect(old.statusCode).toBe(400)
    expect(old.json()).toMatchObject({ code: 'validation_error' })

    const done = await app.inject({
      method: 'POST',
      url: '/api/v1/me/onboarding',
      headers,
      payload: { isAdult: true, termsVersion: DEFAULT_TERMS_VERSION, countryOfResidence: 'PT' },
    })
    expect(done.statusCode).toBe(200)
    expect(meResponseSchema.parse(done.json()).onboarding).toMatchObject({
      required: false,
      countryOfResidence: 'PT',
    })
    const { rows } = await owner.query<{ is_adult: boolean; country_of_residence: string }>(
      'SELECT is_adult, country_of_residence FROM auth."user" WHERE id = $1',
      [userId],
    )
    expect(rows[0]).toEqual({ is_adult: true, country_of_residence: 'PT' })
  })

  it('isAdult falso é recusado pelo contrato', async () => {
    const { cookie } = await seedSession('menor@teko.localhost')
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/onboarding',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      payload: { isAdult: false, termsVersion: DEFAULT_TERMS_VERSION, countryOfResidence: 'BR' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('OAuth', () => {
  it('o sign-in social do GitHub devolve a URL de autorização com o callback do ambiente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      payload: { provider: 'github', callbackURL: '/' },
    })
    expect(res.statusCode).toBe(200)
    const { url } = res.json<{ url: string }>()
    const authorize = new URL(url)
    expect(authorize.hostname).toBe('github.com')
    expect(authorize.searchParams.get('client_id')).toBe('gh-client-id')
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback/github`)
  })

  it('recusa um sign-in vindo de outra origem', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/social',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: { provider: 'github', callbackURL: '/' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('rate limit por usuário', () => {
  it('com sessão, a chave é o user_id', async () => {
    const { userId, cookie } = await seedSession('limite@teko.localhost')
    const res = await app.inject({ url: '/api/v1/provisions?q=C170', headers: { cookie } })
    expect(res.headers['x-ratelimit-limit']).toBe('60')
    const { rows } = await owner.query<{ key: string }>('SELECT key FROM app.rate_limits')
    expect(rows.map((row) => row.key)).toContain(`GET /api/v1/provisions|user:${userId}`)
  })
})
