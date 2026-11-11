import { describe, expect, it } from 'vitest'
import { DEFAULT_TRUST_PROXY, type Env, parseEnv } from './env.ts'
import {
  createPlatformAdapters,
  NETLIFY_CLIENT_IP_TRUSTED,
  NODE_BACKGROUND_DRAIN_MS,
  platformNetwork,
  platformShutdown,
  VERCEL_SHUTDOWN,
} from './platform.ts'

const BASE = { APP_ENV: 'ci', WEB_ORIGIN: 'https://develop--tekoia.netlify.app' } as const
const DIRECT = {
  path: 'direct',
  signatureValid: false,
  headers: { 'x-real-ip': '203.0.113.7' },
  forwardedIp: '172.30.0.9',
} as const
const noop = { onBackgroundFailure: () => {} }

describe('perfil de plataforma', () => {
  it('confia no x-nf-client-connection-ip só com assinatura válida (spike F1 (c))', () => {
    expect(NETLIFY_CLIENT_IP_TRUSTED).toBe(true)
    const env = parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel' })
    const { clientIp } = createPlatformAdapters(env, noop)
    const proxied = {
      path: 'proxied',
      headers: { 'x-nf-client-connection-ip': '203.0.113.20' },
      forwardedIp: '35.170.138.45',
    } as const
    expect(clientIp.resolve({ ...proxied, signatureValid: true })).toEqual({
      ip: '203.0.113.20',
      source: 'netlify_proxy',
    })
    expect(clientIp.resolve({ ...proxied, signatureValid: false })).toEqual({
      ip: null,
      source: 'none',
    })
  })

  it('node (CI e local): rede do Caddy, X-Request-Id do Caddy, drenagem do env', () => {
    const env = parseEnv({ ...BASE, DRAIN_DELAY_MS: '2000', SHUTDOWN_GRACE_MS: '40000' })
    expect(platformNetwork(env)).toEqual({
      trustProxy: ['172.30.0.0/24'],
      requestIdHeader: 'x-request-id',
      eventLoopDelayGuard: true,
    })
    expect(platformShutdown(env)).toEqual({
      drainDelayMs: 2000,
      graceMs: 40_000,
      backgroundDrainMs: NODE_BACKGROUND_DRAIN_MS,
    })
    const adapters = createPlatformAdapters(env, noop)
    expect(adapters.clientIp.resolve(DIRECT)).toEqual({ ip: '172.30.0.9', source: 'trusted_proxy' })
    expect(adapters.invocationDeadline.deadlineFor(0)).toBeNull()
  })

  it('o padrão do trustProxy (rede do Caddy) só vale em development e ci', () => {
    const dev = parseEnv({ ...BASE, APP_ENV: 'development' })
    expect(platformNetwork(dev).trustProxy).toEqual([DEFAULT_TRUST_PROXY])
    // Env montado à mão: parseEnv já barra isto, mas o perfil não pode cair no padrão do CI.
    for (const appEnv of ['staging', 'production'] as const) {
      for (const target of ['node', 'render'] as const) {
        const env: Env = { ...parseEnv(BASE), APP_ENV: appEnv, RUNTIME_TARGET: target }
        expect(() => platformNetwork(env)).toThrow(
          `TRUST_PROXY ausente com APP_ENV=${appEnv}: o padrão (rede do Caddy) só vale em development e ci`,
        )
      }
    }
    const measured: Env = {
      ...parseEnv(BASE),
      APP_ENV: 'production',
      RUNTIME_TARGET: 'render',
      TRUST_PROXY: 2,
    }
    expect(platformNetwork(measured).trustProxy).toBe(2)
  })

  it('render: trustProxy medido no ensaio, sem request id externo, adapters de Node', () => {
    const env = parseEnv({ ...BASE, RUNTIME_TARGET: 'render', TRUST_PROXY: '1' })
    expect(platformNetwork(env)).toEqual({
      trustProxy: 1,
      requestIdHeader: null,
      eventLoopDelayGuard: true,
    })
    expect(platformShutdown(env).backgroundDrainMs).toBe(NODE_BACKGROUND_DRAIN_MS)
    expect(createPlatformAdapters(env, noop).clientIp.resolve(DIRECT).source).toBe('trusted_proxy')
  })

  it('vercel: 1 salto, x-vercel-id, 500 ms no SIGTERM e prazo pelo maxDuration', () => {
    const env = parseEnv({ ...BASE, RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' })
    // Sem limite de atraso do event loop: o congelamento entre invocações contaria como atraso.
    expect(platformNetwork(env)).toEqual({
      trustProxy: 1,
      requestIdHeader: 'x-vercel-id',
      eventLoopDelayGuard: false,
    })
    expect(platformShutdown(env)).toEqual(VERCEL_SHUTDOWN)
    expect(VERCEL_SHUTDOWN.graceMs).toBeLessThan(500)
    const adapters = createPlatformAdapters(env, noop)
    expect(adapters.clientIp.resolve(DIRECT)).toEqual({ ip: '203.0.113.7', source: 'platform' })
    expect(adapters.invocationDeadline.deadlineFor(1_000)).toBe(121_000)
  })
})
