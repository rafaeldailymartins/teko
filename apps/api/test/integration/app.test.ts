import { healthResponseSchema } from '@teko/shared/contracts'
import { isProblemDetails, PROBLEM_CONTENT_TYPE } from '@teko/shared/errors'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../../src/build-app.ts'
import { createContainer, createHttpOptions } from '../../src/composition-root.ts'
import { EnvValidationError, parseEnv } from '../../src/config/env.ts'

/**
 * A aplicação inteira (container real + `buildApp`) exercitada via `app.inject()`, sem rede.
 * A F1 não tem banco: estes testes também provam que `/healthz` sobe sem nenhuma dependência
 * externa configurada.
 */

const WEB_ORIGIN = 'https://tekoia-staging.vercel.app'

/** Recorte do OpenAPI usado nas asserções. */
const openApiDocumentSchema = z.object({
  openapi: z.string(),
  paths: z.record(
    z.string(),
    z.object({
      get: z.object({
        operationId: z.string().optional(),
        responses: z.record(z.string(), z.unknown()),
      }),
    }),
  ),
})

const ENVS = {
  ci: { APP_ENV: 'ci', WEB_ORIGIN, APP_VERSION: '0.0.0-abc1234', GIT_SHA: 'abc1234' },
  staging: {
    APP_ENV: 'staging',
    NODE_ENV: 'production',
    WEB_ORIGIN,
    APP_VERSION: '0.0.0-abc1234',
    GIT_SHA: 'abc1234',
    RUNTIME_TARGET: 'vercel',
    VERCEL: '1',
    VERCEL_REGION: 'gru1',
    FUNCTION_MAX_DURATION_S: '120',
  },
  production: {
    APP_ENV: 'production',
    NODE_ENV: 'production',
    WEB_ORIGIN: 'https://tekoia.vercel.app',
    APP_VERSION: '0.1.0',
    GIT_SHA: 'abc1234',
    RUNTIME_TARGET: 'vercel',
    VERCEL: '1',
    VERCEL_REGION: 'gru1',
    FUNCTION_MAX_DURATION_S: '120',
  },
} as const

/** O runtime da Vercel em staging e produção roda Node 24 (engines.node). */
const NODE_24 = { nodeVersion: 'v24.12.0' }

const apps: FastifyInstance[] = []

async function start(
  name: keyof typeof ENVS,
  extra: Record<string, string> = {},
): Promise<{ app: FastifyInstance; container: ReturnType<typeof createContainer> }> {
  const env = parseEnv({ ...ENVS[name], ...extra }, NODE_24)
  const container = createContainer(env)
  const app = await buildApp({ container, http: createHttpOptions(env) })
  apps.push(app)
  return { app, container }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('GET /healthz e /api/healthz', () => {
  it('responde o contrato de health sem tocar dependências', async () => {
    const { app } = await start('ci')
    const res = await app.inject({ url: '/healthz' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    expect(healthResponseSchema.parse(res.json())).toEqual({
      status: 'ok',
      version: '0.0.0-abc1234',
      gitSha: 'abc1234',
      env: 'ci',
    })
  })

  it('a variante /api/* sai com no-store, Vary: Cookie e sem ETag', async () => {
    const { app } = await start('ci')
    const res = await app.inject({ url: '/api/healthz' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers.vary).toContain('Cookie')
    expect(res.headers.etag).toBeUndefined()
  })

  it('em drenagem responde 503 com status "draining"', async () => {
    const { app, container } = await start('ci')
    container.lifecycle.beginDraining()

    for (const url of ['/healthz', '/api/healthz']) {
      const res = await app.inject({ url })
      expect(res.statusCode).toBe(503)
      expect(res.json()).toMatchObject({ status: 'draining' })
    }
  })

  it('não registra rate limit de aplicação sem banco (sem store compartilhado)', async () => {
    const { app } = await start('ci')
    expect(app.hasDecorator('rateLimit')).toBe(false)
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({ url: '/healthz' })
      expect(res.statusCode).toBe(200)
      expect(res.headers['x-ratelimit-limit']).toBeUndefined()
    }
  })
})

describe('rotas de eval', () => {
  it.each(['staging', 'production'] as const)('/api/v1/_eval/* dá 404 em %s', async (name) => {
    const { app } = await start(name)
    for (const url of [
      '/api/v1/_eval/search?question=x&referenceDate=2024-01-01&source=explicit',
      '/api/v1/_eval/answer',
    ]) {
      const res = await app.inject({ url })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'not_found' })
    }
  })
})

describe('boot em staging e produção', () => {
  it.each(['staging', 'production'] as const)(
    'em %s não sobe sem RUNTIME_TARGET explícito nem com node',
    (name) => {
      for (const target of [undefined, 'node']) {
        const source = { ...ENVS[name], VERCEL: undefined, RUNTIME_TARGET: target }
        expect(() => parseEnv(source, NODE_24)).toThrow(EnvValidationError)
        expect(() => parseEnv(source, NODE_24)).toThrow(/RUNTIME_TARGET: /)
      }
    },
  )

  it.each(['staging', 'production'] as const)(
    'em %s com VERCEL=1 não sobe fora do perfil vercel (trustProxy do CI, x-request-id do cliente)',
    (name) => {
      for (const extra of [
        { RUNTIME_TARGET: undefined },
        { RUNTIME_TARGET: 'render', TRUST_PROXY: '1' },
      ]) {
        expect(() => parseEnv({ ...ENVS[name], ...extra }, NODE_24)).toThrow(
          /VERCEL=1 está presente; exige RUNTIME_TARGET=vercel/,
        )
      }
    },
  )

  it('em produção na Vercel não ecoa o X-Request-Id do cliente', async () => {
    const { app } = await start('production')
    const res = await app.inject({
      url: '/healthz',
      headers: { 'x-request-id': 'attacker-chosen-id-123' },
    })
    expect(res.headers['x-request-id']).not.toBe('attacker-chosen-id-123')
  })
})

describe('perfil de plataforma', () => {
  it('na Vercel usa o x-vercel-id da borda como request id', async () => {
    const { app } = await start('ci', { RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' })
    const vercelId = 'gru1::gru1::8lfqm-1762780000000-0a1b2c3d4e5f'
    const res = await app.inject({
      url: '/healthz',
      headers: { 'x-vercel-id': vercelId, 'x-request-id': 'cliente-forjado-0001' },
    })
    expect(res.headers['x-request-id']).toBe(vercelId)
  })

  it.each([
    ['vercel', { FUNCTION_MAX_DURATION_S: '120' }, '198.51.100.5'],
    ['render', { TRUST_PROXY: '2' }, '203.0.113.50'],
    ['node', {}, '127.0.0.1'],
  ] as const)('trustProxy em %s', async (target, extra, expectedIp) => {
    const { app } = await start('ci', { RUNTIME_TARGET: target, ...extra })
    app.get('/__ip', async (request) => ({ ip: request.ip }))
    // O inject chega do 127.0.0.1 (salto 0); o X-Forwarded-For vem da borda.
    const res = await app.inject({
      url: '/__ip',
      headers: { 'x-forwarded-for': '192.0.2.1, 203.0.113.50, 198.51.100.5' },
    })
    expect(res.json()).toEqual({ ip: expectedIp })
  })

  it('o resolvedor de IP da Vercel ignora o forwardedIp', async () => {
    const { container } = await start('ci', {
      RUNTIME_TARGET: 'vercel',
      FUNCTION_MAX_DURATION_S: '120',
    })
    expect(
      container.clientIp.resolve({
        headers: { 'x-real-ip': '203.0.113.9' },
        forwardedIp: '127.0.0.1',
      }),
    ).toEqual({ ip: '203.0.113.9', source: 'platform' })
  })

  it('no Render não confia no X-Request-Id do cliente', async () => {
    const { app } = await start('ci', { RUNTIME_TARGET: 'render', TRUST_PROXY: '1' })
    const res = await app.inject({
      url: '/healthz',
      headers: { 'x-request-id': 'cliente-forjado-0001' },
    })
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('cabeçalhos de segurança e request id', () => {
  it("aplica CSP default-src 'none' e ecoa o X-Request-Id do Caddy", async () => {
    const { app } = await start('ci')
    const res = await app.inject({
      url: '/healthz',
      headers: { 'x-request-id': '6f1c2a5e-6d0b-4e61-9a43-2a1f0e4e7d1b' },
    })

    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-request-id']).toBe('6f1c2a5e-6d0b-4e61-9a43-2a1f0e4e7d1b')
  })

  it('substitui um X-Request-Id fora do formato', async () => {
    const { app } = await start('ci')
    const res = await app.inject({ url: '/healthz', headers: { 'x-request-id': 'bad id' } })
    expect(res.headers['x-request-id']).not.toBe('bad id')
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('erros RFC 9457', () => {
  it('rota inexistente sai como problem+json com traceId = request id', async () => {
    const { app } = await start('ci')
    const res = await app.inject({
      url: '/api/v1/nada?q=1',
      headers: { 'x-request-id': 'caddy-request-0001' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE)
    expect(res.headers['cache-control']).toBe('private, no-store')
    const body: unknown = res.json()
    expect(isProblemDetails(body)).toBe(true)
    expect(body).toMatchObject({
      code: 'not_found',
      status: 404,
      traceId: 'caddy-request-0001',
      instance: '/api/v1/nada',
    })
  })

  it('usa o mesmo limite de corpo do Caddy da stack de CI (32 KB)', async () => {
    const { app } = await start('ci')
    expect(app.initialConfig.bodyLimit).toBe(32 * 1024)
  })
})

describe('OpenAPI + Scalar', () => {
  it.each(['ci', 'staging'] as const)(
    'em %s publica o documento em /api/docs/json',
    async (name) => {
      const { app } = await start(name)
      const res = await app.inject({ url: '/api/docs/json' })

      expect(res.statusCode).toBe(200)
      const document = openApiDocumentSchema.parse(res.json())
      expect(document.openapi).toBe('3.1.0')
      const evalPaths = name === 'ci' ? ['/api/v1/_eval/search'] : []
      expect(Object.keys(document.paths).sort()).toEqual(
        [
          '/api/healthz',
          '/healthz',
          '/api/v1/coverage',
          '/api/v1/provisions',
          '/api/v1/provisions/{stableKey}/diff',
          '/api/v1/provisions/{stableKey}/timeline',
          ...evalPaths,
        ].sort(),
      )
      expect(document.paths['/api/healthz']?.get.operationId).toBe('getHealth')
      expect(Object.keys(document.paths['/healthz']?.get.responses ?? {}).sort()).toEqual([
        '200',
        '503',
      ])

      const page = await app.inject({ url: '/api/docs/' })
      expect(page.statusCode).toBe(200)
      expect(page.headers['content-type']).toContain('text/html')
    },
  )

  it('em produção não expõe documentação', async () => {
    const { app } = await start('production')
    for (const url of ['/api/docs', '/api/docs/', '/api/docs/json']) {
      const res = await app.inject({ url })
      expect(res.statusCode).toBe(404)
      expect(res.json()).toMatchObject({ code: 'not_found' })
    }
  })
})

describe('CORS', () => {
  // Web e API na mesma origem (ADR 0029): nenhuma rota responde CORS, nem o stream.
  it('nenhuma rota responde CORS, nem o preflight do stream', async () => {
    const { app } = await start('ci')
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/questions/0b9f5b0e-3f43-4c62-9f7e-0d1c2b3a4f5e/stream',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    const res = await app.inject({ url: '/api/healthz', headers: { origin: WEB_ORIGIN } })
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
