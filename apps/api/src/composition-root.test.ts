import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '#adapters/out/telemetry/logger.ts'
import {
  createBlobStore,
  createContainer,
  createEmbeddings,
  createFixtureSeeder,
  createHttpOptions,
  createReranker,
  createRuntime,
  logBackgroundFailure,
  reviewStatusesFor,
} from './composition-root.ts'
import { parseEnv } from './config/env.ts'
import { VERCEL_SHUTDOWN } from './config/platform.ts'

const BASE = {
  APP_ENV: 'ci',
  WEB_ORIGIN: 'https://tekoia-staging.vercel.app',
  APP_VERSION: '0.0.0-abc1234',
  GIT_SHA: 'abc1234',
  LOG_LEVEL: 'silent',
} as const

describe('createContainer', () => {
  it('liga health e lifecycle ao mesmo relógio e build', () => {
    const container = createContainer(parseEnv(BASE), { clock: { now: () => new Date(1_000) } })

    expect(container.appEnv).toBe('ci')
    expect(container.buildInfo).toEqual({ version: '0.0.0-abc1234', gitSha: 'abc1234' })
    expect(container.useCases.getHealth()).toEqual({
      status: 'ok',
      version: '0.0.0-abc1234',
      gitSha: 'abc1234',
      env: 'ci',
    })
    container.lifecycle.beginDraining()
    expect(container.useCases.getHealth().status).toBe('draining')
    expect(container.lifecycle.drainingForMs()).toBe(0)
  })

  it('usa o relógio do sistema por padrão e fecha sem erro', async () => {
    const container = createContainer(parseEnv(BASE))
    container.lifecycle.beginDraining()
    expect(container.lifecycle.drainingForMs()).toBeGreaterThanOrEqual(0)
    await expect(container.close()).resolves.toBeUndefined()
  })

  it('fora da Vercel, o stream só tem o teto de 100 s', () => {
    expect(createContainer(parseEnv(BASE)).streamBudget.timeoutMs(0, 290_000)).toBe(100_000)
  })

  it('na Vercel, o teto do stream respeita o maxDuration configurado', () => {
    const container = createContainer(
      parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' }),
    )
    // 120 s de prazo, 30 s já gastos: 90 s − 20 s de reserva.
    expect(container.streamBudget.timeoutMs(0, 30_000)).toBe(70_000)
  })

  it('entrega falhas de tarefas pós-resposta ao observador', async () => {
    const onBackgroundFailure = vi.fn()
    const container = createContainer(parseEnv(BASE), { onBackgroundFailure })
    container.backgroundTasks.run('flush', Promise.reject(new Error('x')), { timeoutMs: 100 })
    await container.backgroundTasks.drain(1_000)
    expect(onBackgroundFailure).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'flush', outcome: 'failed' }),
    )
  })

  it('sem observador, descarta falhas sem lançar', async () => {
    const container = createContainer(parseEnv(BASE))
    container.backgroundTasks.run('flush', Promise.reject(new Error('x')), { timeoutMs: 100 })
    await expect(container.backgroundTasks.drain(1_000)).resolves.toBe(0)
  })
})

describe('createBlobStore (ADR 0030)', () => {
  const GITHUB = {
    GITHUB_TOKEN: 'ghs_token-de-teste-com-mais-de-20',
    GITHUB_REPOSITORY: 'dono/repo',
  }
  it('sem credenciais, o store em memória; com o GITHUB_TOKEN, o GitHub Releases (padrão)', () => {
    expect(createBlobStore(parseEnv(BASE))).toHaveProperty('keys')
    expect(createBlobStore(parseEnv({ ...BASE, ...GITHUB }))).toHaveProperty('sha256Of')
    expect(
      createBlobStore(parseEnv({ ...BASE, ...GITHUB, BLOB_STORE: 'github-releases' })),
    ).toHaveProperty('sha256Of')
  })
})

describe('createHttpOptions', () => {
  it('no CI e local confia só na rede do Caddy, usa o X-Request-Id dele e não liga rate limit', () => {
    expect(createHttpOptions(parseEnv(BASE))).toEqual({
      trustProxy: ['172.30.0.0/24'],
      requestIdHeader: 'x-request-id',
      eventLoopDelayGuard: true,
      docs: true,
      webOrigin: 'https://tekoia-staging.vercel.app',
      evalRoutes: true,
    })
  })

  it('liga o rate limit com o store do banco, na janela de 60 s', () => {
    const store = { hit: async () => ({ count: 1, resetInMs: 1 }) }
    const options = createHttpOptions(parseEnv({ ...BASE, RATE_LIMIT_PER_MINUTE: '30' }), store)
    expect(options.rateLimit).toEqual({ store, max: 30, timeWindowMs: 60_000 })
  })

  it('em produção não expõe docs', () => {
    const env = parseEnv({
      ...BASE,
      APP_ENV: 'production',
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://tekoia.vercel.app',
      RUNTIME_TARGET: 'render',
      TRUST_PROXY: '1',
    })
    expect(createHttpOptions(env).docs).toBe(false)
  })

  it('na Vercel confia em exatamente 1 salto e usa o x-vercel-id', () => {
    const options = createHttpOptions(
      parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' }),
    )
    expect(options.trustProxy).toBe(1)
    expect(options.requestIdHeader).toBe('x-vercel-id')
    expect(options.eventLoopDelayGuard).toBe(false)
  })

  it('no Render usa o trustProxy medido e nunca o X-Request-Id do cliente', () => {
    const options = createHttpOptions(
      parseEnv({ ...BASE, RUNTIME_TARGET: 'render', TRUST_PROXY: '10.0.0.0/8' }),
    )
    expect(options.trustProxy).toEqual(['10.0.0.0/8'])
    expect(options.requestIdHeader).toBeNull()
    expect(options.eventLoopDelayGuard).toBe(true)
  })
})

describe('logBackgroundFailure', () => {
  it('loga como warn, com nome, desfecho e erro', () => {
    const logger = createLogger({
      level: 'silent',
      appEnv: 'ci',
      version: '0.0.0',
      gitSha: 'unknown',
      pretty: false,
    })
    const warn = vi.spyOn(logger, 'warn')
    const error = new Error('x')
    logBackgroundFailure(logger)({ name: 'flush', outcome: 'failed', error })
    expect(warn).toHaveBeenCalledWith(
      { task: 'flush', outcome: 'failed', err: error },
      'background task did not complete',
    )
  })
})

describe('createRuntime', () => {
  it('monta o app pronto para responder ao /healthz', async () => {
    const { app, container, shutdown } = await createRuntime(parseEnv(BASE))
    const res = await app.inject({ url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(container.useCases.getHealth())
    expect(shutdown.graceMs).toBe(105_000)
    await app.close()
  })

  it('na Vercel usa o perfil de encerramento de 500 ms', async () => {
    const { app, shutdown } = await createRuntime(
      parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' }),
    )
    expect(shutdown).toEqual(VERCEL_SHUTDOWN)
    await app.close()
  })
})

const FAKE_EMBEDDINGS = {
  EMBEDDINGS_PROVIDER: 'fake',
  EMBEDDINGS_FIXTURE_PATH: 'test/fixtures/corpus/embeddings.json.gz',
} as const

describe('serviços do corpus (F2)', () => {
  it('produção busca só auto e approved; staging inclui pending', () => {
    expect(reviewStatusesFor('production')).toEqual(['auto', 'approved'])
    expect(reviewStatusesFor('ci')).toEqual(['auto', 'approved'])
    expect(reviewStatusesFor('staging')).toEqual(['auto', 'approved', 'pending'])
  })

  it('createEmbeddings escolhe o adapter do EMBEDDINGS_PROVIDER', () => {
    expect(createEmbeddings(parseEnv(BASE))).toBeNull()
    expect(createEmbeddings(parseEnv({ ...BASE, ...FAKE_EMBEDDINGS }))?.model).toBe(
      '@cf/baai/bge-m3',
    )
    const workersAi = createEmbeddings(
      parseEnv({
        ...BASE,
        EMBEDDINGS_PROVIDER: 'workers-ai',
        CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CF_AI_TOKEN: 'token-de-teste-com-20-chars',
      }),
    )
    expect(workersAi?.dimensions).toBe(1024)
  })

  it('createReranker só monta o Workers AI com RERANKER_PROVIDER=workers-ai (ADR 0027)', () => {
    expect(createReranker(parseEnv(BASE))).toBeNull()
    const reranker = createReranker(
      parseEnv({
        ...BASE,
        RERANKER_PROVIDER: 'workers-ai',
        CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CF_AI_TOKEN: 'token-de-teste-com-20-chars',
      }),
    )
    expect(reranker?.model).toBe('@cf/baai/bge-reranker-base')
  })

  it('sem DATABASE_URL, a busca fica de fora (o container HTTP nunca escreve no corpus)', async () => {
    const container = createContainer(parseEnv({ ...BASE, ...FAKE_EMBEDDINGS }))
    expect(container.useCases.retrieval).toBeNull()
    expect(
      container.useCases.resolveReferenceDate({
        input: { periodoApuracao: '2026-10' },
        source: 'default',
        questionText: 'em 05/2006?',
      }),
    ).toMatchObject({ kind: 'resolved', reference: { value: '2006-05-01' } })
    await container.close()
  })

  it.each(['node', 'vercel'])(
    'com DATABASE_URL (%s), monta a busca sem conectar e fecha o pool',
    async (runtimeTarget) => {
      const container = createContainer(
        parseEnv({
          ...BASE,
          ...FAKE_EMBEDDINGS,
          RUNTIME_TARGET: runtimeTarget,
          FUNCTION_MAX_DURATION_S: '120',
          DATABASE_URL: 'postgresql://teko_app:x@127.0.0.1:1/teko',
        }),
        { applicationName: 'teko-test' },
      )
      expect(container.useCases.retrieval).not.toBeNull()
      expect(container.useCases).not.toHaveProperty('writeCorpus')
      await expect(container.close()).resolves.toBeUndefined()
      await expect(container.close()).resolves.toBeUndefined()
    },
  )

  it('o seed da fixture usa o container da ingestão (URL do owner), sem conectar ao montar', async () => {
    const ownerUrl = 'postgresql://teko_owner:x@127.0.0.1:1/teko'
    const seeder = createFixtureSeeder(
      parseEnv({ ...BASE, ...FAKE_EMBEDDINGS, DATABASE_URL: ownerUrl }),
      ownerUrl,
      { clock: { now: () => new Date('2026-11-10T12:00:00-03:00') } },
    )
    expect(typeof seeder.seedFixtureCorpus).toBe('function')
    await expect(seeder.close()).resolves.toBeUndefined()
    expect(() => createFixtureSeeder(parseEnv(BASE), ownerUrl)).toThrow(/EMBEDDINGS_PROVIDER/)
  })
})
