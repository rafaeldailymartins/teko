import { describe, expect, it, vi } from 'vitest'
import { createLogger } from '#adapters/out/telemetry/logger.ts'
import {
  createContainer,
  createHttpOptions,
  createRuntime,
  logBackgroundFailure,
} from './composition-root.ts'
import { parseEnv } from './config/env.ts'
import { VERCEL_SHUTDOWN } from './config/platform.ts'

const BASE = {
  APP_ENV: 'ci',
  WEB_ORIGIN: 'https://develop--teko-web.netlify.app',
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

describe('createHttpOptions', () => {
  it('no CI e local confia só na rede do Caddy, usa o X-Request-Id dele e não liga rate limit', () => {
    expect(createHttpOptions(parseEnv(BASE))).toEqual({
      webOrigin: 'https://develop--teko-web.netlify.app',
      trustProxy: ['172.30.0.0/24'],
      requestIdHeader: 'x-request-id',
      docs: true,
    })
  })

  it('em produção não expõe docs', () => {
    const env = parseEnv({
      ...BASE,
      APP_ENV: 'production',
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://teko-web.netlify.app',
      RUNTIME_TARGET: 'render',
      TRUST_PROXY: '1',
    })
    expect(createHttpOptions(env).docs).toBe(false)
  })

  it('na Vercel confia em exatamente 1 salto e usa o x-vercel-id', () => {
    const options = createHttpOptions(parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel' }))
    expect(options.trustProxy).toBe(1)
    expect(options.requestIdHeader).toBe('x-vercel-id')
  })

  it('no Render usa o trustProxy medido e nunca o X-Request-Id do cliente', () => {
    const options = createHttpOptions(
      parseEnv({ ...BASE, RUNTIME_TARGET: 'render', TRUST_PROXY: '10.0.0.0/8' }),
    )
    expect(options.trustProxy).toEqual(['10.0.0.0/8'])
    expect(options.requestIdHeader).toBeNull()
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
    const { app, shutdown } = await createRuntime(parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel' }))
    expect(shutdown).toEqual(VERCEL_SHUTDOWN)
    await app.close()
  })
})
