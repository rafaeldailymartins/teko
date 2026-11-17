import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import {
  askQuestionResponseSchema,
  CONVERSATIONS_PAGE_SIZE,
  conversationListResponseSchema,
  historyResponseSchema,
  parseStreamError,
  questionDetailSchema,
  quotaResponseSchema,
  type TekoStreamChunk,
  tekoStreamChunkSchema,
} from '@teko/shared/contracts'
import { containsPii, cpfCheckDigits } from '@teko/shared/pii'
import { asSchema, uiMessageChunkSchema } from 'ai'
import type { FastifyInstance } from 'fastify'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createFakeLlmAdapter } from '#adapters/out/fakes/fake-llm-adapter.ts'
import type { Container } from '#app/container.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '#app/ports/embedding-port.ts'
import type { LlmEvent, LlmModel, LlmRequest } from '#app/ports/llm-port.ts'
import {
  recordingLlmTracing,
  recordingTraceFeedback,
} from '#app/ports/testing/recording-llm-tracing.ts'
import { buildApp } from '../../../src/build-app.ts'
import {
  createContainer,
  createDevSessionSeeder,
  createHttpOptions,
} from '../../../src/composition-root.ts'
import { type Env, parseEnv } from '../../../src/config/env.ts'
import { FIXTURE_EMBEDDINGS, seedFixtureCorpus } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Pergunta e stream de ponta a ponta sobre a fixture única (DoD da F4), com o LLM fake e um
 * espião em volta dele. Cada teste usa um usuário próprio, para que cotas e o "1 stream ativo por
 * usuário" de um teste não interfiram em outro.
 */

const ORIGIN = 'http://localhost:3000'
const SECRET = 'teste'.repeat(8)
const GOYAZES =
  'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?'
const JSON_HEADERS = { origin: ORIGIN, 'content-type': 'application/json' }

interface Spy extends LlmModel {
  readonly requests: LlmRequest[]
  /** Instantes (ms) em que o sinal de cada chamada abortou. */
  readonly aborts: number[]
}

function spyModel(): Spy {
  const inner = createFakeLlmAdapter()
  const requests: LlmRequest[] = []
  const aborts: number[] = []
  return {
    provider: inner.provider,
    model: inner.model,
    zeroDataRetention: true,
    requests,
    aborts,
    stream(request): AsyncIterable<LlmEvent> {
      requests.push(request)
      request.signal.addEventListener('abort', () => aborts.push(Date.now()), { once: true })
      return inner.stream(request)
    },
  }
}

let database: TestDatabase
let owner: pg.Client
const apps: FastifyInstance[] = []
const containers: Container[] = []

function envFor(extra: Record<string, string>): Env {
  return parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: ORIGIN,
    DATABASE_URL: database.appUrl,
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
    BETTER_AUTH_SECRET: SECRET,
    LLM_PROVIDER: 'fake',
    ...extra,
  })
}

/** Embeddings fora do ar: a busca degrada para `lexical_only`. */
const DOWN_EMBEDDINGS: EmbeddingPort = {
  model: '@cf/baai/bge-m3',
  dimensions: 1024,
  embed: () => Promise.reject(new EmbeddingUnavailableError('Workers AI fora do ar')),
}

async function startApp(
  extra: Record<string, string> = {},
  options: { readonly embeddings?: EmbeddingPort } = {},
): Promise<{ app: FastifyInstance; spy: Spy; container: Container }> {
  const spy = spyModel()
  const env = envFor(extra)
  const container = createContainer(env, {
    applicationName: 'teko-test',
    clock: { now: () => new Date() },
    llmModels: [spy],
    ...options,
  })
  containers.push(container)
  const app = await buildApp({ container, http: createHttpOptions(env, container.rateLimitStore) })
  apps.push(app)
  return { app, spy, container }
}

async function newUser(): Promise<{ cookie: string; userId: string }> {
  // Relógio real: a sessão vale 7 dias a partir de agora (com um instante fixo, vencia sozinha).
  const seeder = createDevSessionSeeder(envFor({}), { now: () => new Date() })
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

function askBody(question: string, extra: Record<string, unknown> = {}) {
  return {
    conversationId: randomUUID(),
    question,
    locale: 'pt-BR',
    families: ['rcte'],
    periodoApuracao: '2006-05',
    source: 'periodo_apuracao',
    ...extra,
  }
}

async function ask(app: FastifyInstance, cookie: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/questions',
    headers: { ...JSON_HEADERS, cookie },
    payload: body,
  })
}

async function streamOf(app: FastifyInstance, cookie: string, questionId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/questions/${questionId}/stream`,
    headers: { ...JSON_HEADERS, cookie },
    payload: '{}',
  })
}

function parseSse(body: string): TekoStreamChunk[] {
  return body
    .split('\n\n')
    .filter((event) => event.startsWith('data: ') && event !== 'data: [DONE]')
    .map((event) => tekoStreamChunkSchema.parse(JSON.parse(event.slice('data: '.length))))
}

async function acceptedId(app: FastifyInstance, cookie: string, question = GOYAZES) {
  const res = await ask(app, cookie, askBody(question))
  const body = askQuestionResponseSchema.parse(res.json())
  if (body.status !== 'accepted') {
    throw new Error(`esperava accepted, veio ${body.status}`)
  }
  return body.questionId
}

/** CPF válido gerado (não é de ninguém). */
function validCpf(): string {
  const base = '529982247'
  return `${base.slice(0, 3)}.${base.slice(3, 6)}.${base.slice(6)}-${cpfCheckDigits(base)}`
}

beforeAll(async () => {
  database = await createTestDatabase()
  await seedFixtureCorpus(database.ownerUrl)
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
}, 120_000)

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()))
  await Promise.all(containers.map((container) => container.close()))
  await owner?.end()
  await database?.drop()
})

describe('POST /api/v1/questions', () => {
  it('exige sessão e onboarding', async () => {
    const { app } = await startApp()
    expect((await ask(app, '', askBody(GOYAZES))).statusCode).toBe(401)
    const { cookie, userId } = await newUser()
    await owner.query('UPDATE auth."user" SET is_adult = false WHERE id = $1', [userId])
    const res = await ask(app, cookie, askBody(GOYAZES))
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'onboarding_required' })
  })

  it('query string → 400, mesmo da própria origem', async () => {
    const { app } = await startApp()
    const { cookie } = await newUser()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions?question=x',
      headers: { ...JSON_HEADERS, cookie },
      payload: askBody(GOYAZES),
    })
    expect(res.statusCode).toBe(400)
  })

  it('fora da cobertura: recusa sem chamar o LLM e grava a pergunta', async () => {
    const { app, spy } = await startApp()
    const { cookie } = await newUser()
    const res = await ask(app, cookie, askBody(GOYAZES, { periodoApuracao: '2027-01' }))
    const body = askQuestionResponseSchema.parse(res.json())
    expect(body).toMatchObject({ status: 'refused', refusal: { reason: 'out_of_coverage' } })
    expect(spy.requests).toHaveLength(0)
    const id = body.status === 'refused' ? body.questionId : ''
    const detail = await app.inject({ url: `/api/v1/questions/${id}`, headers: { cookie } })
    expect(questionDetailSchema.parse(detail.json())).toMatchObject({
      status: 'refused',
      refusal: { reason: 'out_of_coverage' },
    })
  })

  it('datas conflitantes no texto → needs_clarification, sem gravar', async () => {
    const { app } = await startApp()
    const { cookie } = await newUser()
    const res = await ask(
      app,
      cookie,
      askBody('Qual a alíquota em 03/2024 e em 05/2024?', {
        periodoApuracao: undefined,
        referenceDate: '2024-03-01',
        source: 'default',
      }),
    )
    expect(askQuestionResponseSchema.parse(res.json()).status).toBe('needs_clarification')
  })

  it('duas perguntas simultâneas do mesmo usuário respeitam a cota de 1', async () => {
    const { app } = await startApp({ QUOTA_QUESTIONS_PER_USER_DAILY: '1' })
    const { cookie } = await newUser()
    const [first, second] = await Promise.all([
      ask(app, cookie, askBody(`${GOYAZES} (a)`)),
      ask(app, cookie, askBody(`${GOYAZES} (b)`)),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    expect(statuses).toEqual([200, 429])
    const rejected = first.statusCode === 429 ? first : second
    expect(rejected.json()).toMatchObject({ code: 'quota_exceeded', meta: { scope: 'user_daily' } })
  })

  it('em drenagem, perguntas novas recebem 503', async () => {
    const { app, container } = await startApp()
    const { cookie } = await newUser()
    container.lifecycle.beginDraining()
    const res = await ask(app, cookie, askBody(GOYAZES))
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ code: 'service_paused' })
  })

  it('kill switch: sem cache, 503 service_paused', async () => {
    const { app } = await startApp({ LLM_KILL_SWITCH: 'true' })
    const { cookie } = await newUser()
    const res = await ask(app, cookie, askBody(`${GOYAZES} (kill)`))
    expect(res.json()).toMatchObject({ code: 'service_paused' })
  })
})

describe('POST /api/v1/questions/:id/stream', () => {
  it('responde em UI Message Stream válido, grava e depois serve do cache', async () => {
    const { app, spy } = await startApp()
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie)
    const res = await streamOf(app, cookie, id)
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    expect(res.headers['x-vercel-ai-ui-message-stream']).toBe('v1')
    expect(res.headers['cache-control']).toBe('no-cache, no-transform')
    expect(res.body.endsWith('data: [DONE]\n\n')).toBe(true)

    const chunks = parseSse(res.body)
    const schema = asSchema(uiMessageChunkSchema)
    for (const chunk of chunks) {
      const check = await schema.validate?.(chunk)
      expect(check?.success, JSON.stringify(chunk)).toBe(true)
    }
    const types = chunks.map((chunk) => chunk.type)
    expect(types[0]).toBe('start')
    expect(types.slice(1, 3)).toEqual(['data-reference-date', 'data-meta'])
    expect(types).toContain('text-delta')
    expect(types.at(-1)).toBe('finish')
    expect(spy.requests).toHaveLength(1)

    const detail = questionDetailSchema.parse(
      (await app.inject({ url: `/api/v1/questions/${id}`, headers: { cookie } })).json(),
    )
    expect(detail.status).toBe('answered')
    expect(detail.answer?.markdown).toContain('(cite:S1)')
    expect(detail.answer?.citations.some((citation) => citation.valid)).toBe(true)

    const again = askQuestionResponseSchema.parse((await ask(app, cookie, askBody(GOYAZES))).json())
    expect(again).toMatchObject({ status: 'answered', answer: { meta: { cached: true } } })
    expect(spy.requests).toHaveLength(1)
  })

  it('Origin errado → 403; segundo stream da mesma pergunta → 409 stream_busy', async () => {
    const { app } = await startApp()
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie, `${GOYAZES} (busy)`)
    const foreign = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/stream`,
      headers: { origin: 'https://evil.example', 'content-type': 'application/json', cookie },
      payload: '{}',
    })
    expect(foreign.statusCode).toBe(403)
    expect((await streamOf(app, cookie, id)).statusCode).toBe(200)
    const second = await streamOf(app, cookie, id)
    expect(second.statusCode).toBe(409)
    expect(second.json()).toMatchObject({ code: 'stream_busy' })
  })

  it('pergunta de outro usuário → 404', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const bob = await newUser()
    const id = await acceptedId(app, alice.cookie, `${GOYAZES} (alice)`)
    expect((await streamOf(app, bob.cookie, id)).statusCode).toBe(404)
    const detail = await app.inject({
      url: `/api/v1/questions/${id}`,
      headers: { cookie: bob.cookie },
    })
    expect(detail.statusCode).toBe(404)
  })

  it('embedding fora do ar → lexical_only rotulado', async () => {
    const { app } = await startApp({}, { embeddings: DOWN_EMBEDDINGS })
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie, `${GOYAZES} (sem embedding)`)
    const chunks = parseSse((await streamOf(app, cookie, id)).body)
    const meta = chunks.find((chunk) => chunk.type === 'data-meta')
    expect(meta).toMatchObject({ data: { retrievalMode: 'lexical_only', provider: 'fake' } })
  })

  it('com a reescrita ligada (ADR 0034): uma chamada curta antes da busca, sem PII, e a resposta sai', async () => {
    const { app, spy } = await startApp({ QUERY_REWRITE_ENABLED: 'true' })
    const { cookie } = await newUser()
    const question = `${GOYAZES} Meu CPF é ${validCpf()}.`
    const id = await acceptedId(app, cookie, question)
    const res = await streamOf(app, cookie, id)
    expect(res.body.endsWith('data: [DONE]\n\n')).toBe(true)
    expect(spy.requests).toHaveLength(2)
    const [rewrite, answer] = spy.requests
    expect(rewrite?.prompt.startsWith('<pergunta>')).toBe(true)
    expect(rewrite?.prompt).toContain('[CPF]')
    expect(rewrite?.temperature).toBe(0)
    expect(answer?.prompt).toContain('<source id="S1"')
    expect(containsPii(spy.requests.map((request) => request.prompt).join('\n'))).toBe(false)
    const detail = questionDetailSchema.parse(
      (await app.inject({ url: `/api/v1/questions/${id}`, headers: { cookie } })).json(),
    )
    expect(detail.status).toBe('answered')

    // Fora da cobertura a recusa vem antes da busca: nem a reescrita chama o LLM.
    const before = spy.requests.length
    const refused = await ask(app, cookie, askBody(GOYAZES, { periodoApuracao: '2027-01' }))
    expect(askQuestionResponseSchema.parse(refused.json())).toMatchObject({ status: 'refused' })
    expect(spy.requests).toHaveLength(before)
  })

  it('nenhuma PII válida chega ao LLM nem ao banco', async () => {
    const { app, spy } = await startApp()
    const { cookie } = await newUser()
    const question = `${GOYAZES} Meu CPF é ${validCpf()} e o e-mail ana.souza@example.com.`
    const id = await acceptedId(app, cookie, question)
    await streamOf(app, cookie, id)
    const payload = spy.requests.map((request) => `${request.system}\n${request.prompt}`).join('\n')
    expect(payload).toContain('[CPF]')
    expect(containsPii(payload)).toBe(false)
    const { rows } = await owner.query<{ question_redacted: string }>(
      'SELECT question_redacted FROM app.questions WHERE id = $1',
      [id],
    )
    expect(containsPii(rows[0]?.question_redacted ?? '')).toBe(false)
  })

  it('citação inexistente → recusa citation_invalid; HTML e imagem do modelo não saem', async () => {
    const { app } = await startApp()
    const { cookie } = await newUser()
    const bad = await acceptedId(app, cookie, `${GOYAZES} [[fault:bad-citation]]`)
    const badChunks = parseSse((await streamOf(app, cookie, bad)).body)
    expect(badChunks.find((chunk) => chunk.type === 'data-refusal')).toMatchObject({
      data: { reason: 'citation_invalid' },
    })
    const xss = await acceptedId(app, cookie, `${GOYAZES} [[fault:xss]]`)
    const xssBody = (await streamOf(app, cookie, xss)).body
    expect(xssBody).not.toContain('<script>')
    expect(xssBody).not.toContain('evil.example/x.png')
  })

  it('cadeia fora do ar → error upstream_unavailable retryable e pergunta failed', async () => {
    const { app } = await startApp()
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie, `${GOYAZES} [[fault:5xx]]`)
    const chunks = parseSse((await streamOf(app, cookie, id)).body)
    const error = chunks.at(-1)
    expect(error?.type).toBe('error')
    expect(parseStreamError(error?.type === 'error' ? error.errorText : '')).toEqual({
      code: 'upstream_unavailable',
      retryable: true,
    })
    const { rows } = await owner.query<{ status: string }>(
      'SELECT status FROM app.questions WHERE id = $1',
      [id],
    )
    expect(rows[0]?.status).toBe('failed')
  })

  it('o teto do stream corta por timer próprio, com error retryable', async () => {
    const { app } = await startApp({ STREAM_MAX_SECONDS: '1' })
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie, `${GOYAZES} [[fault:slow]]`)
    const started = Date.now()
    const chunks = parseSse((await streamOf(app, cookie, id)).body)
    expect(Date.now() - started).toBeLessThan(5000)
    const error = chunks.at(-1)
    expect(parseStreamError(error?.type === 'error' ? error.errorText : '')).toEqual({
      code: 'upstream_unavailable',
      retryable: true,
    })
  })

  it('a desconexão do cliente aborta o LLM em menos de 1 s e grava aborted', async () => {
    const { app, spy } = await startApp()
    const { cookie } = await newUser()
    const id = await acceptedId(app, cookie, `${GOYAZES} [[fault:slow]] (desconexão)`)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const { port } = app.server.address() as AddressInfo
    const controller = new AbortController()
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/v1/questions/${id}/stream`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, cookie },
      body: '{}',
      signal: controller.signal,
    })
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('text-delta')) {
      const part = await reader?.read()
      if (part === undefined || part.done) {
        throw new Error(`o stream acabou antes do texto: ${seen}`)
      }
      seen += decoder.decode(part.value)
    }
    const disconnectedAt = Date.now()
    controller.abort()
    await expect.poll(() => spy.aborts.length, { timeout: 2000 }).toBe(1)
    expect((spy.aborts[0] ?? Infinity) - disconnectedAt).toBeLessThan(1000)
    await expect
      .poll(
        async () =>
          (
            await owner.query<{ status: string }>(
              'SELECT status FROM app.questions WHERE id = $1',
              [id],
            )
          ).rows[0]?.status,
        { timeout: 3000 },
      )
      .toBe('aborted')
  })
})

describe('histórico, feedback e cota', () => {
  it('lista a conversa, grava o feedback do dono e mostra a cota', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const bob = await newUser()
    const body = askBody(`${GOYAZES} (histórico)`)
    const res = await ask(app, alice.cookie, body)
    const id = askQuestionResponseSchema.parse(res.json())
    const questionId = 'questionId' in id ? id.questionId : ''
    const history = historyResponseSchema.parse(
      (
        await app.inject({
          url: `/api/v1/questions?conversationId=${body.conversationId}`,
          headers: { cookie: alice.cookie },
        })
      ).json(),
    )
    expect(history.items.map((item) => item.id)).toEqual([questionId])

    const feedback = (cookie: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/questions/${questionId}/feedback`,
        headers: { ...JSON_HEADERS, cookie },
        payload: { rating: 'down', reason: 'wrong_citation' },
      })
    expect((await feedback(alice.cookie)).statusCode).toBe(204)
    expect((await feedback(bob.cookie)).statusCode).toBe(404)

    const quota = quotaResponseSchema.parse(
      (await app.inject({ url: '/api/v1/me/quota', headers: { cookie: alice.cookie } })).json(),
    )
    expect(quota.user).toEqual({ used: 1, limit: 30 })
  })
})

describe('traces de LLM (Langfuse) e custo-sombra', () => {
  /** Units do Langfuse somadas na linha `global` (todos os dias). */
  async function langfuseUnits(): Promise<number> {
    const { rows } = await owner.query<{ units: number }>(
      `SELECT coalesce(sum(langfuse_units), 0)::int AS units FROM app.usage_daily
       WHERE scope = 'global'`,
    )
    return rows[0]?.units ?? 0
  }

  it('grava trace_id, units e shadow_cost_usd em resposta, cache e recusa; feedback vira score', async () => {
    const port = recordingLlmTracing()
    const feedbackPort = recordingTraceFeedback()
    const spy = spyModel()
    const env = envFor({})
    const container = createContainer(env, {
      applicationName: 'teko-test',
      clock: { now: () => new Date() },
      llmModels: [spy],
      llmTracing: { port, feedback: feedbackPort },
    })
    containers.push(container)
    const app = await buildApp({
      container,
      http: createHttpOptions(env, container.rateLimitStore),
    })
    apps.push(app)
    const { cookie, userId } = await newUser()
    const before = await langfuseUnits()

    // Resposta pelo stream: trace com retrieval e answer.
    const question = `${GOYAZES} (langfuse)`
    const answeredId = await acceptedId(app, cookie, question)
    const chunks = parseSse((await streamOf(app, cookie, answeredId)).body)
    expect(chunks.at(-1)?.type).toBe('finish')
    // Acerto do cache e recusa por cobertura: só a raiz, gravada em tarefa pós-resposta.
    const cached = askQuestionResponseSchema.parse(
      (await ask(app, cookie, askBody(question))).json(),
    )
    expect(cached).toMatchObject({ status: 'answered', answer: { meta: { cached: true } } })
    const refused = askQuestionResponseSchema.parse(
      (await ask(app, cookie, askBody(question, { periodoApuracao: '2027-01' }))).json(),
    )
    expect(refused.status).toBe('refused')
    await container.backgroundTasks.drain(5000)

    expect(port.queries.map((query) => [query.start.cached, query.end?.outcome])).toEqual([
      [false, 'answered'],
      [true, 'answered'],
      [false, 'refused'],
    ])
    expect(port.queries[0]?.generations).toHaveLength(1)
    const rows = await owner.query<{
      status: string
      shadow_cost_usd: string | null
      langfuse_trace_id: string | null
    }>(
      `SELECT status, shadow_cost_usd, langfuse_trace_id FROM app.questions
       WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    )
    expect(rows.rows.map((row) => row.status)).toEqual(['answered', 'answered', 'refused'])
    expect(rows.rows.map((row) => row.langfuse_trace_id)).toEqual(['trace-1', 'trace-2', 'trace-3'])
    // O fake não tem preço: custo 0, mas sempre gravado.
    expect(rows.rows.map((row) => Number(row.shadow_cost_usd))).toEqual([0, 0, 0])
    // 4 (answer-question + retrieve-context + generate-answer) + 2 (cache) + 2 (recusa).
    expect((await langfuseUnits()) - before).toBe(8)

    const feedback = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${answeredId}/feedback`,
      headers: { ...JSON_HEADERS, cookie },
      payload: { rating: 'down', reason: 'incomplete' },
    })
    expect(feedback.statusCode).toBe(204)
    await container.backgroundTasks.drain(5000)
    expect(feedbackPort.calls).toEqual([
      { traceId: 'trace-1', questionId: answeredId, rating: 'down', reason: 'incomplete' },
    ])
    expect((await langfuseUnits()) - before).toBe(9)
  })

  it('falha do Langfuse no feedback não muda a resposta', async () => {
    const feedbackPort = recordingTraceFeedback()
    feedbackPort.fail = true
    const env = envFor({})
    const container = createContainer(env, {
      applicationName: 'teko-test',
      clock: { now: () => new Date() },
      llmModels: [spyModel()],
      llmTracing: { port: recordingLlmTracing(), feedback: feedbackPort },
    })
    containers.push(container)
    const app = await buildApp({
      container,
      http: createHttpOptions(env, container.rateLimitStore),
    })
    apps.push(app)
    const { cookie } = await newUser()
    const refused = askQuestionResponseSchema.parse(
      (await ask(app, cookie, askBody(GOYAZES, { periodoApuracao: '2027-01' }))).json(),
    )
    await container.backgroundTasks.drain(5000)
    const id = refused.status === 'refused' ? refused.questionId : ''
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${id}/feedback`,
      headers: { ...JSON_HEADERS, cookie },
      payload: { rating: 'up' },
    })
    expect(res.statusCode).toBe(204)
    await container.backgroundTasks.drain(5000)
    expect(feedbackPort.calls).toHaveLength(1)
  })
})

describe('GET /api/v1/conversations', () => {
  /** Grava perguntas direto no banco, com instantes separados por microssegundos. */
  async function seedConversations(userId: string): Promise<{ twoQuestions: string }> {
    const base = "timestamptz '2026-11-10 12:00:00+00'"
    const series = (title: string, count: number, at: string) =>
      owner.query(
        `INSERT INTO app.questions (user_id, conversation_id, question_redacted, locale, families,
           reference_date, reference_source, status, created_at)
         SELECT $1::uuid, gen_random_uuid(), $2 || i, 'pt-BR', '{rcte}', '2008-05-01', 'explicit',
           'answered', ${at}
         FROM generate_series(1, $3::int) AS i`,
        [userId, title, count],
      )
    await series('Pergunta ', 22, `${base} + i * interval '1 microsecond'`)
    await series('Empate ', 2, `${base} + interval '30 microseconds'`)
    const twoQuestions = randomUUID()
    await owner.query(
      `INSERT INTO app.questions (user_id, conversation_id, question_redacted, locale, families,
         reference_date, reference_source, status, created_at)
       VALUES ($1, $2, E'Primeira\\n  pergunta da conversa', 'pt-BR', '{rcte}', '2008-05-01',
                'periodo_apuracao', 'answered', ${base} + interval '40 microseconds'),
              ($1, $2, 'Segunda', 'pt-BR', '{rcte}', '2010-01-01', 'periodo_apuracao', 'pending',
                ${base} + interval '50 microseconds')`,
      [userId, twoQuestions],
    )
    return { twoQuestions }
  }

  it('exige sessão; lista só as conversas do usuário, em páginas por cursor, sem repetir', async () => {
    const { app } = await startApp()
    expect((await app.inject({ url: '/api/v1/conversations' })).statusCode).toBe(401)

    const alice = await newUser()
    const bob = await newUser()
    const { twoQuestions } = await seedConversations(alice.userId)
    await seedConversations(bob.userId)

    const first = await app.inject({
      url: '/api/v1/conversations',
      headers: { cookie: alice.cookie },
    })
    expect(first.statusCode).toBe(200)
    expect(first.headers['cache-control']).toBe('private, no-store')
    const page1 = conversationListResponseSchema.parse(first.json())
    expect(page1.items).toHaveLength(CONVERSATIONS_PAGE_SIZE)
    expect(page1.items[0]).toEqual({
      conversationId: twoQuestions,
      title: 'Primeira pergunta da conversa',
      questionCount: 2,
      updatedAt: '2026-11-10T12:00:00.000Z',
      lastReferenceDate: '2010-01-01',
    })
    // O empate no instante sai pelo id da conversa, decrescente.
    const ties = page1.items.slice(1, 3)
    expect(ties.map((item) => item.title).sort()).toEqual(['Empate 1', 'Empate 2'])
    expect([...ties].sort((a, b) => (a.conversationId < b.conversationId ? 1 : -1))).toEqual(ties)

    // A fronteira da página cai entre instantes que só diferem nos microssegundos.
    const cursor = page1.nextCursor ?? ''
    expect(cursor).not.toBe('')
    const page2 = conversationListResponseSchema.parse(
      (
        await app.inject({
          url: `/api/v1/conversations?cursor=${cursor}`,
          headers: { cookie: alice.cookie },
        })
      ).json(),
    )
    expect(page2.nextCursor).toBeNull()
    const titles = [...page1.items, ...page2.items].map((item) => item.title)
    expect(titles).toHaveLength(25)
    expect(new Set(titles).size).toBe(25)
    expect(titles.slice(3)).toEqual(
      Array.from({ length: 22 }, (_, index) => `Pergunta ${22 - index}`),
    )
    const all = [...page1.items, ...page2.items].map((item) => item.conversationId)
    const bobs = conversationListResponseSchema.parse(
      (await app.inject({ url: '/api/v1/conversations', headers: { cookie: bob.cookie } })).json(),
    )
    expect(bobs.items.some((item) => all.includes(item.conversationId))).toBe(false)
  })

  it('cursor inválido ou parâmetro desconhecido → 400 validation_error', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    for (const query of ['cursor=bad', 'cursor=a%20b', 'limit=5']) {
      const res = await app.inject({
        url: `/api/v1/conversations?${query}`,
        headers: { cookie: alice.cookie },
      })
      expect(res.statusCode, query).toBe(400)
      expect(res.json()).toMatchObject({ code: 'validation_error' })
    }
  })

  it('usuário sem perguntas → lista vazia', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const res = await app.inject({
      url: '/api/v1/conversations',
      headers: { cookie: alice.cookie },
    })
    expect(res.json()).toEqual({ items: [], nextCursor: null })
  })
})

describe('DELETE /api/v1/conversations/:id', () => {
  function deleteConversation(app: FastifyInstance, cookie: string, id: string) {
    return app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${id}`,
      headers: { origin: ORIGIN, cookie },
    })
  }

  async function quotaUsed(app: FastifyInstance, cookie: string): Promise<number> {
    const res = await app.inject({ url: '/api/v1/me/quota', headers: { cookie } })
    return quotaResponseSchema.parse(res.json()).user.used
  }

  async function usageRows(userId: string) {
    const { rows } = await owner.query(
      `SELECT day::text, scope, requests, stream_seconds, tokens_in, tokens_out
       FROM app.usage_daily WHERE scope = 'user:' || $1 ORDER BY day`,
      [userId],
    )
    return rows
  }

  /** Grava uma pergunta direto no banco (para os estados de stream). */
  async function insertQuestion(
    userId: string,
    conversationId: string,
    status: string,
    streamStartedAt: string | null,
  ): Promise<void> {
    await owner.query(
      `INSERT INTO app.questions (user_id, conversation_id, question_redacted, locale, families,
         reference_date, reference_source, status, stream_started_at)
       VALUES ($1, $2, 'Pergunta em stream', 'pt-BR', '{rcte}', '2008-05-01', 'explicit', $3,
         now() - $4::interval)`,
      [userId, conversationId, status, streamStartedAt],
    )
  }

  it('o dono exclui a conversa com o que pende dela; a cota e a lista do resto ficam', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const first = askBody(`${GOYAZES} (exclusão 1)`)
    const idOf = async (body: Record<string, unknown>) => {
      const res = askQuestionResponseSchema.parse((await ask(app, alice.cookie, body)).json())
      return 'questionId' in res ? res.questionId : ''
    }
    const firstId = await idOf(first)
    await streamOf(app, alice.cookie, firstId)
    // A segunda pergunta entra na mesma conversa.
    const secondId = await idOf({ ...first, question: `${GOYAZES} (exclusão 2)` })
    await streamOf(app, alice.cookie, secondId)
    const feedback = await app.inject({
      method: 'POST',
      url: `/api/v1/questions/${firstId}/feedback`,
      headers: { ...JSON_HEADERS, cookie: alice.cookie },
      payload: { rating: 'up' },
    })
    expect(feedback.statusCode).toBe(204)
    const kept = askBody(`${GOYAZES} (fica)`)
    await ask(app, alice.cookie, kept)

    const usedBefore = await quotaUsed(app, alice.cookie)
    const usageBefore = await usageRows(alice.userId)
    expect(usedBefore).toBe(3)

    const res = await deleteConversation(app, alice.cookie, first.conversationId)
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')

    const left = await owner.query(
      `SELECT (SELECT count(*)::int FROM app.questions WHERE conversation_id = $1) AS questions,
              (SELECT count(*)::int FROM app.feedback WHERE question_id = ANY($2::uuid[])) AS feedback`,
      [first.conversationId, [firstId, secondId]],
    )
    expect(left.rows[0]).toEqual({ questions: 0, feedback: 0 })
    for (const id of [firstId, secondId]) {
      const detail = await app.inject({
        url: `/api/v1/questions/${id}`,
        headers: { cookie: alice.cookie },
      })
      expect(detail.statusCode).toBe(404)
    }
    const history = historyResponseSchema.parse(
      (
        await app.inject({
          url: `/api/v1/questions?conversationId=${first.conversationId}`,
          headers: { cookie: alice.cookie },
        })
      ).json(),
    )
    expect(history.items).toEqual([])
    const list = conversationListResponseSchema.parse(
      (
        await app.inject({ url: '/api/v1/conversations', headers: { cookie: alice.cookie } })
      ).json(),
    )
    expect(list.items.map((item) => item.conversationId)).toEqual([kept.conversationId])

    // A cota não volta: o uso do dia continua igual, linha por linha.
    expect(await quotaUsed(app, alice.cookie)).toBe(usedBefore)
    expect(await usageRows(alice.userId)).toEqual(usageBefore)

    // Excluir de novo: a conversa já não existe.
    expect((await deleteConversation(app, alice.cookie, first.conversationId)).statusCode).toBe(404)
  })

  it('conversa de outro usuário → o mesmo 404 de uma inexistente, sem apagar nada', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const bob = await newUser()
    const body = askBody(`${GOYAZES} (de alice)`)
    await ask(app, alice.cookie, body)

    const foreign = await deleteConversation(app, bob.cookie, body.conversationId)
    const missing = await deleteConversation(app, bob.cookie, randomUUID())
    expect(foreign.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
    const strip = (problem: Record<string, unknown>) => {
      const { traceId: _trace, instance: _instance, ...rest } = problem
      return rest
    }
    expect(strip(foreign.json())).toEqual(strip(missing.json()))
    expect(foreign.json()).toMatchObject({ code: 'not_found' })

    const { rows } = await owner.query(
      'SELECT count(*)::int AS total FROM app.questions WHERE conversation_id = $1',
      [body.conversationId],
    )
    expect(rows[0]).toEqual({ total: 1 })
  })

  it('sem sessão → 401; Origin errado → 403; id inválido → 400', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const id = randomUUID()
    expect((await deleteConversation(app, '', id)).statusCode).toBe(401)
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${id}`,
      headers: { origin: 'https://evil.example', cookie: alice.cookie },
    })
    expect(foreign.statusCode).toBe(403)
    const invalid = await deleteConversation(app, alice.cookie, 'nao-e-uuid')
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json()).toMatchObject({ code: 'validation_error' })
  })

  it('resposta em stream → 409 stream_busy; um stream parado há mais de 110 s não segura', async () => {
    const { app } = await startApp()
    const alice = await newUser()
    const streaming = randomUUID()
    await insertQuestion(alice.userId, streaming, 'answered', null)
    await insertQuestion(alice.userId, streaming, 'streaming', '5 seconds')
    const busy = await deleteConversation(app, alice.cookie, streaming)
    expect(busy.statusCode).toBe(409)
    expect(busy.json()).toMatchObject({ code: 'stream_busy' })
    const { rows } = await owner.query(
      'SELECT count(*)::int AS total FROM app.questions WHERE conversation_id = $1',
      [streaming],
    )
    expect(rows[0]).toEqual({ total: 2 })

    const stale = randomUUID()
    await insertQuestion(alice.userId, stale, 'streaming', '5 minutes')
    expect((await deleteConversation(app, alice.cookie, stale)).statusCode).toBe(204)
  })

  it('o cache de respostas é de todos: excluir a conversa de um não tira a resposta do outro', async () => {
    const { app, spy } = await startApp()
    const alice = await newUser()
    const bob = await newUser()
    const question = `${GOYAZES} (cache compartilhado)`
    const body = askBody(question)
    const res = askQuestionResponseSchema.parse((await ask(app, alice.cookie, body)).json())
    await streamOf(app, alice.cookie, 'questionId' in res ? res.questionId : '')
    expect(spy.requests).toHaveLength(1)

    expect((await deleteConversation(app, alice.cookie, body.conversationId)).statusCode).toBe(204)

    const cached = askQuestionResponseSchema.parse(
      (await ask(app, bob.cookie, askBody(question))).json(),
    )
    expect(cached).toMatchObject({ status: 'answered', answer: { meta: { cached: true } } })
    expect(spy.requests).toHaveLength(1)
  })
})

describe('POST /api/v1/_eval/answer (APP_ENV=ci)', () => {
  it('roda o pipeline inteiro sem sessão nem persistência', async () => {
    const { app } = await startApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/_eval/answer',
      headers: JSON_HEADERS,
      payload: {
        question: GOYAZES,
        families: ['rcte'],
        periodoApuracao: '2006-05',
        source: 'periodo_apuracao',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      provider: 'fake',
      refusal: null,
      answer: { meta: { cached: false } },
    })
  })
})
