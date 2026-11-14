import {
  coverageResponseSchema,
  provisionDiffResponseSchema,
  provisionSearchResponseSchema,
  provisionTimelineResponseSchema,
} from '@teko/shared/contracts'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { createPgRateLimitStore } from '#adapters/out/persistence/drizzle/repositories/pg-rate-limit-store.ts'
import type { Container } from '#app/container.ts'
import { buildApp } from '../../../src/build-app.ts'
import { createHttpOptions } from '../../../src/composition-root.ts'
import { parseEnv } from '../../../src/config/env.ts'
import { seedFixtureCorpus, testContainer, testEnv } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Fundação HTTP da F4 sobre a fixture única, com o runtime como `teko_app`: cobertura, paleta,
 * linha do tempo e diff de dispositivos, rate limit compartilhado entre instâncias, guarda de
 * `Origin` e a rota de eval do CI.
 */

const PARAGRAPH_6 = 'go:rcte:art:76:par:6'
const RATE_LIMIT = 3

let database: TestDatabase
const containers: Container[] = []
const apps: FastifyInstance[] = []

async function startApp(rateLimitPerMinute = 60): Promise<FastifyInstance> {
  const env = parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: database.appUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FAKE_STRICT: 'true',
    EMBEDDINGS_FIXTURE_PATH: 'test/fixtures/corpus/embeddings.json.gz',
    RATE_LIMIT_PER_MINUTE: String(rateLimitPerMinute),
  })
  const container = testContainer(database.appUrl)
  containers.push(container)
  const app = await buildApp({ container, http: createHttpOptions(env, container.rateLimitStore) })
  apps.push(app)
  return app
}

let app: FastifyInstance

beforeAll(async () => {
  database = await createTestDatabase()
  await seedFixtureCorpus(database.ownerUrl)
  // Garante que o env do helper e o desta suíte batem (mesma origem e mesmos fakes).
  expect(testEnv(database.appUrl).WEB_ORIGIN).toBe('http://localhost:3000')
  app = await startApp()
}, 120_000)

afterAll(async () => {
  await Promise.all(apps.map((instance) => instance.close()))
  await Promise.all(containers.map((container) => container.close()))
  await database?.drop()
})

describe('GET /api/v1/coverage', () => {
  it('devolve a cobertura efetiva e a corpus_version, sem rate limit', async () => {
    const res = await app.inject({ url: '/api/v1/coverage' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-ratelimit-limit']).toBeUndefined()
    const body = coverageResponseSchema.parse(res.json())
    expect(body.corpusVersion).toBeGreaterThan(0)
    expect(body.families.map((family) => family.family)).toContain('rcte')
  })
})

describe('/api/v1/provisions', () => {
  it('a paleta acha o § 6º do art. 76 pelo rótulo, na data pedida', async () => {
    const res = await app.inject({
      url: `/api/v1/provisions?q=${encodeURIComponent('art. 76, § 6')}&family=rcte&at=2006-05-01`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe('60')
    const body = provisionSearchResponseSchema.parse(res.json())
    expect(body.at).toBe('2006-05-01')
    expect(body.items.map((item) => item.stableKey)).toContain(PARAGRAPH_6)
    for (const item of body.items) {
      expect(item.family).toBe('rcte')
      expect(item.validity.from === null || item.validity.from <= '2006-05-01').toBe(true)
      expect(item.validity.to === null || '2006-05-01' < item.validity.to).toBe(true)
    }
  })

  it('a paleta acha pelo texto e escapa curingas do LIKE', async () => {
    const byText = await app.inject({ url: '/api/v1/provisions?q=GOYAZES&at=2006-05-01' })
    expect(provisionSearchResponseSchema.parse(byText.json()).items.length).toBeGreaterThan(0)
    const wildcard = await app.inject({ url: '/api/v1/provisions?q=%25%25&at=2006-05-01' })
    expect(wildcard.statusCode).toBe(200)
    expect(provisionSearchResponseSchema.parse(wildcard.json()).items).toEqual([])
  })

  it('a linha do tempo traz as redações em ordem', async () => {
    const res = await app.inject({ url: `/api/v1/provisions/${PARAGRAPH_6}/timeline` })
    expect(res.statusCode).toBe(200)
    const body = provisionTimelineResponseSchema.parse(res.json())
    expect(body.versions.length).toBeGreaterThan(1)
    const starts = body.versions.map((version) => version.validity.from ?? '')
    expect([...starts].sort()).toEqual(starts)
  })

  it('o diff compara as redações de 2006 e de 2026', async () => {
    const res = await app.inject({
      url: `/api/v1/provisions/${PARAGRAPH_6}/diff?from=2006-05-01&to=2026-11-01`,
    })
    expect(res.statusCode).toBe(200)
    const body = provisionDiffResponseSchema.parse(res.json())
    expect(body.before?.text).not.toBe(body.after?.text)
    expect(body.segments.some((segment) => segment.op !== 'equal')).toBe(true)
  })

  it('chave inexistente → 404; datas invertidas → 400', async () => {
    const missing = await app.inject({ url: '/api/v1/provisions/go:rcte:art:9999/timeline' })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toMatchObject({ code: 'not_found' })
    const inverted = await app.inject({
      url: `/api/v1/provisions/${PARAGRAPH_6}/diff?from=2026-01-01&to=2006-01-01`,
    })
    expect(inverted.statusCode).toBe(400)
    expect(inverted.json()).toMatchObject({ code: 'validation_error' })
  })
})

describe('rate limit em Postgres', () => {
  it('vale entre duas instâncias apontando para o mesmo banco', async () => {
    const first = await startApp(RATE_LIMIT)
    const second = await startApp(RATE_LIMIT)
    const url = '/api/v1/provisions?q=C170&at=2024-01-01'
    // IP próprio deste teste (as outras suítes contam no IP padrão do inject).
    const remoteAddress = '203.0.113.50'
    // Até duas tentativas: a janela é fixa (60 s) e a sequência pode cruzar a virada do minuto.
    let statuses: number[] = []
    for (let attempt = 0; attempt < 2; attempt += 1) {
      statuses = []
      for (const instance of [first, second, first, second]) {
        statuses.push((await instance.inject({ url, remoteAddress })).statusCode)
      }
      if (statuses.includes(429)) {
        break
      }
    }
    expect(statuses).toEqual([200, 200, 200, 429])
    const limited = await second.inject({ url, remoteAddress })
    expect(limited.statusCode).toBe(429)
    expect(limited.json()).toMatchObject({ code: 'rate_limited' })
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('o store devolve a contagem e o tempo até o fim da janela', async () => {
    const pool: Database = createDatabase({ url: database.appUrl, applicationName: 'teko-test' })
    try {
      const store = createPgRateLimitStore(pool.pool)
      const first = await store.hit('test|store', 60_000)
      const second = await store.hit('test|store', 60_000)
      expect(second.count - first.count).toBe(1)
      expect(second.resetInMs).toBeGreaterThan(0)
      expect(second.resetInMs).toBeLessThanOrEqual(60_000)
    } finally {
      await pool.close()
    }
  })
})

describe('guarda de Origin', () => {
  it('mutação em /api/v1 com Origin de outro site → 403, mesmo em rota inexistente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'forbidden' })
  })
})

describe('GET /api/v1/_eval/search (APP_ENV=ci)', () => {
  it('devolve a recuperação sem LLM no formato das evals', async () => {
    const question =
      'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?'
    const res = await app.inject({
      url: `/api/v1/_eval/search?question=${encodeURIComponent(question)}&families=rcte&periodoApuracao=2006-05&source=periodo_apuracao`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ outcome: string; referenceDate: string; hits: unknown[] }>()
    expect(body.outcome).toBe('evidence')
    expect(body.referenceDate).toBe('2006-05-01')
    expect(body.hits.length).toBeGreaterThan(0)
  })
})
