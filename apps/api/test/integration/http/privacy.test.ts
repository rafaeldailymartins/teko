import { randomUUID } from 'node:crypto'
import {
  askQuestionResponseSchema,
  conversationListResponseSchema,
  meExportSchema,
} from '@teko/shared/contracts'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Container } from '#app/container.ts'
import { buildApp } from '../../../src/build-app.ts'
import {
  createContainer,
  createDevSessionSeeder,
  createHttpOptions,
  createMaintenance,
} from '../../../src/composition-root.ts'
import { type Env, parseEnv } from '../../../src/config/env.ts'
import { FIXTURE_EMBEDDINGS, seedFixtureCorpus } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Direitos do titular sobre o banco real (`teko_app`): exportação, exclusão com cascata e a sessão
 * revogada (DoD da F4: depois do `DELETE /me`, o mesmo cookie não lê dados). E o expurgo da
 * manutenção semanal.
 */

const ORIGIN = 'http://localhost:3000'
const GOYAZES =
  'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?'
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }

let database: TestDatabase
let env: Env
let container: Container
let app: FastifyInstance
let owner: pg.Client

async function newUser(): Promise<{ cookie: string; userId: string }> {
  // Relógio real: a sessão vale 7 dias a partir de agora (com um instante fixo, vencia sozinha).
  const seeder = createDevSessionSeeder(env, { now: () => new Date() })
  try {
    const session = await seeder.seed({
      email: `${randomUUID()}@teko.localhost`,
      name: 'Teste',
      country: 'BR',
    })
    return { cookie: `${session.cookieName}=${session.cookieValue}`, userId: session.userId }
  } finally {
    await seeder.close()
  }
}

async function askAndAnswer(cookie: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/questions',
    headers: { ...JSON_HEADERS, cookie },
    payload: {
      conversationId: randomUUID(),
      question: `${GOYAZES} (${randomUUID()})`,
      locale: 'pt-BR',
      families: ['rcte'],
      periodoApuracao: '2006-05',
      source: 'periodo_apuracao',
    },
  })
  const body = askQuestionResponseSchema.parse(res.json())
  if (body.status !== 'accepted') {
    throw new Error(`esperava accepted, veio ${body.status}`)
  }
  await app.inject({
    method: 'POST',
    url: `/api/v1/questions/${body.questionId}/stream`,
    headers: { ...JSON_HEADERS, cookie },
    payload: '{}',
  })
  await app.inject({
    method: 'POST',
    url: `/api/v1/questions/${body.questionId}/feedback`,
    headers: { ...JSON_HEADERS, cookie },
    payload: { rating: 'up' },
  })
  return body.questionId
}

beforeAll(async () => {
  database = await createTestDatabase()
  await seedFixtureCorpus(database.ownerUrl)
  env = parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: ORIGIN,
    DATABASE_URL: database.appUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
    BETTER_AUTH_SECRET: 'teste'.repeat(8),
    LLM_PROVIDER: 'fake',
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

describe('GET /api/v1/me/export', () => {
  it('exporta perfil, perguntas e feedback como anexo, sem tokens', async () => {
    const { cookie, userId } = await newUser()
    const questionId = await askAndAnswer(cookie)
    const res = await app.inject({ url: '/api/v1/me/export', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    const data = meExportSchema.parse(res.json())
    expect(data.user.id).toBe(userId)
    expect(data.questions.map((question) => question.id)).toEqual([questionId])
    expect(data.feedback).toMatchObject([{ questionId, rating: 'up' }])
    expect(res.body).not.toContain('session_token')
  })
})

describe('DELETE /api/v1/me', () => {
  it('apaga tudo do usuário, limpa os cookies e o mesmo cookie não lê mais dados', async () => {
    const { cookie, userId } = await newUser()
    const questionId = await askAndAnswer(cookie)
    const before = conversationListResponseSchema.parse(
      (await app.inject({ url: '/api/v1/conversations', headers: { cookie } })).json(),
    )
    expect(before.items).toHaveLength(1)
    const foreign = await app.inject({ method: 'DELETE', url: '/api/v1/me', headers: { cookie } })
    expect(foreign.statusCode).toBe(403)

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me',
      headers: { cookie, origin: ORIGIN },
    })
    expect(res.statusCode).toBe(204)
    const cleared = [res.headers['set-cookie']].flat().join('\n')
    expect(cleared).toContain('teko-stg.session_token=; Path=/; Max-Age=0')

    const counts = await owner.query<{
      users: number
      sessions: number
      questions: number
      usage: number
    }>(
      `SELECT (SELECT count(*) FROM auth."user" WHERE id = $1)::int AS users,
              (SELECT count(*) FROM auth.session WHERE user_id = $1)::int AS sessions,
              (SELECT count(*) FROM app.questions WHERE user_id = $1)::int AS questions,
              (SELECT count(*) FROM app.usage_daily WHERE scope = 'user:' || $1)::int AS usage`,
      [userId],
    )
    expect(counts.rows[0]).toEqual({ users: 0, sessions: 0, questions: 0, usage: 0 })

    // A sessão foi revogada: as rotas que leem o banco não devolvem mais nada do usuário.
    expect((await app.inject({ url: '/api/v1/me/export', headers: { cookie } })).statusCode).toBe(
      401,
    )
    expect(
      (await app.inject({ url: `/api/v1/questions/${questionId}`, headers: { cookie } }))
        .statusCode,
    ).toBeGreaterThanOrEqual(401)
    expect(
      (await app.inject({ url: '/api/v1/conversations', headers: { cookie } })).statusCode,
    ).toBe(401)
    const ask = await app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers: { ...JSON_HEADERS, cookie },
      payload: {
        conversationId: randomUUID(),
        question: GOYAZES,
        locale: 'pt-BR',
        periodoApuracao: '2006-05',
        source: 'periodo_apuracao',
      },
    })
    expect(ask.statusCode).toBe(401)
  })
})

describe('cli maintenance purge', () => {
  it('expira pending antigas e apaga perguntas de mais de 90 dias', async () => {
    const { cookie, userId } = await newUser()
    const old = await askAndAnswer(cookie)
    await owner.query(
      `UPDATE app.questions SET created_at = now() - interval '91 days' WHERE id = $1`,
      [old],
    )
    const pending = await owner.query<{ id: string }>(
      `INSERT INTO app.questions (user_id, conversation_id, question_redacted, locale, families,
         reference_date, reference_source, status, created_at)
       VALUES ($1, gen_random_uuid(), 'x', 'pt-BR', '{}', '2024-01-01', 'explicit', 'pending',
               now() - interval '2 days')
       RETURNING id`,
      [userId],
    )
    // Janelas do rate limit do Better Auth (IP e caminho): a parada há 2 dias sai, a recente fica.
    const now = Date.now()
    await owner.query(
      `INSERT INTO auth.rate_limit (key, count, last_request)
       VALUES ('10.9.9.1|/sign-in/email', 3, $1), ('10.9.9.2|/sign-in/email', 1, $2)`,
      [now - 2 * 86_400_000, now],
    )
    const maintenance = createMaintenance(env.DATABASE_URL)
    try {
      const counts = await maintenance.purge()
      expect(counts.questions).toBeGreaterThanOrEqual(1)
      expect(counts.expiredPending).toBeGreaterThanOrEqual(1)
      expect(counts.rateLimits).toBeGreaterThanOrEqual(1)
    } finally {
      await maintenance.close()
    }
    const windows = await owner.query<{ key: string }>(
      `SELECT key FROM auth.rate_limit WHERE key LIKE '10.9.9.%' ORDER BY key`,
    )
    expect(windows.rows).toEqual([{ key: '10.9.9.2|/sign-in/email' }])
    const rows = await owner.query<{ id: string; status: string }>(
      'SELECT id, status FROM app.questions WHERE id = ANY($1::uuid[])',
      [[old, pending.rows[0]?.id]],
    )
    expect(rows.rows).toEqual([{ id: pending.rows[0]?.id, status: 'expired' }])
  })
})
