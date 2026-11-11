import { createHmac } from 'node:crypto'
import { AppEnv, HealthStatus } from '@teko/shared/contracts'
import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Container } from '#app/container.ts'
import type { SpikeRouteOptions } from '../http-options.ts'
import { decorateContainer } from '../plugins/container.ts'
import { cookieNames, inspectSignature, SPIKE_COOKIE, spikeRoutes, spikeSseBody } from './spike.ts'

const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres'

function signedToken(claims: Record<string, unknown>, secret = SECRET): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${signature}`
}

const run = vi.fn()

const container: Container = {
  appEnv: AppEnv.Staging,
  buildInfo: { version: '0.1.0', gitSha: 'abc1234' },
  lifecycle: {
    status: () => HealthStatus.Ok,
    isDraining: () => false,
    beginDraining: () => true,
    drainingForMs: () => null,
  },
  useCases: {
    getHealth: () => ({
      status: HealthStatus.Ok,
      version: '0.1.0',
      gitSha: 'abc1234',
      env: AppEnv.Staging,
    }),
  },
  backgroundTasks: { run, pending: () => 0, drain: async () => 0 },
  clientIp: { resolve: () => ({ ip: null, source: 'none' }) },
  streamBudget: { timeoutMs: () => 100_000 },
  close: async () => {},
}

const options: SpikeRouteOptions = {
  nodeVersion: 'v24.22.2',
  region: 'gru1',
  maxDurationS: 300,
  sensitiveLength: 12,
  proxySecret: SECRET,
}

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  decorateContainer(app, container)
  await app.register(spikeRoutes(options))
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

describe('inspectSignature', () => {
  const claims = { iss: 'netlify', deploy_context: 'develop', exp: 1_900_000_000 }

  it('sem header: ausente e sem verificação', () => {
    expect(inspectSignature(undefined, SECRET)).toEqual({
      present: false,
      claims: null,
      verified: null,
    })
    expect(inspectSignature('', SECRET)).toEqual({ present: false, claims: null, verified: null })
  })

  it('assinatura válida: claims e verified true', () => {
    expect(inspectSignature(signedToken(claims), SECRET)).toEqual({
      present: true,
      claims,
      verified: true,
    })
  })

  it('outro segredo: claims, mas verified false', () => {
    expect(
      inspectSignature(signedToken(claims, 'outro-segredo-qualquer-com-32-caracteres!'), SECRET),
    ).toEqual({
      present: true,
      claims,
      verified: false,
    })
  })

  it('sem segredo configurado: claims e verified null', () => {
    expect(inspectSignature(signedToken(claims))).toEqual({ present: true, claims, verified: null })
  })

  it.each(['a.b', 'nao-e-jws', 'a.!!!.c'])('malformado (%s): sem claims', (token) => {
    expect(inspectSignature(token, SECRET)).toMatchObject({
      present: true,
      claims: null,
      verified: false,
    })
    expect(inspectSignature(token)).toMatchObject({ present: true, claims: null, verified: null })
  })

  it('payload que não é objeto: sem claims', () => {
    const payload = Buffer.from('"texto"').toString('base64url')
    expect(inspectSignature(`h.${payload}.s`).claims).toBeNull()
  })
})

describe('cookieNames', () => {
  it('devolve só os nomes', () => {
    expect(cookieNames('a=1; teko_spike=1;  b = 2 ; =x')).toEqual(['a', 'teko_spike', 'b'])
  })

  it.each([undefined, ''])('sem cookies (%j)', (header) => {
    expect(cookieNames(header)).toEqual([])
  })
})

describe('spikeSseBody', () => {
  it('start, heartbeats e end, contando a partir do início', async () => {
    const chunks: string[] = []
    for await (const chunk of spikeSseBody(
      { firstByteDelayS: 0, durationS: 2, heartbeatS: 1 },
      new AbortController().signal,
    )) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toMatch(/^event: start\ndata: \{"elapsedMs":\d+\}\n\n$/)
    expect(chunks.filter((c) => c.startsWith(': hb '))).toHaveLength(1)
    expect(chunks.at(-1)).toMatch(/^event: end\ndata: \{"elapsedMs":\d+\}\n\n$/)
  })

  it('desconexão antes do primeiro byte encerra sem emitir nada', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const chunks: string[] = []
    for await (const chunk of spikeSseBody(
      { firstByteDelayS: 5, durationS: 10, heartbeatS: 1 },
      controller.signal,
    )) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual([])
  })

  it('erro que não é abort sobe', async () => {
    const boom = (): number => {
      throw new Error('relógio quebrado')
    }
    const body = spikeSseBody(
      { firstByteDelayS: 0, durationS: 1, heartbeatS: 1 },
      new AbortController().signal,
      boom,
    )
    await expect(body.next()).rejects.toThrow('relógio quebrado')
  })
})

describe('spikeRoutes', () => {
  it('GET /api/_spike/sse: headers de SSE sem cache e o corpo completo', async () => {
    const res = await app.inject({
      url: '/api/_spike/sse?firstByteDelayS=0&durationS=1&heartbeatS=1',
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-cache, no-transform')
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(res.body).toContain('event: start')
    expect(res.body).toContain('event: end')
  })

  it('GET /api/_spike/sse recusa parâmetros fora dos limites', async () => {
    const res = await app.inject({ url: '/api/_spike/sse?durationS=999' })
    expect(res.statusCode).toBe(400)
  })

  it.each(['GET', 'POST'] as const)(
    '%s /api/_spike/echo: claims verificadas, IPs e nomes de cookies',
    async (method) => {
      const token = signedToken({ iss: 'netlify', deploy_context: 'develop' })
      const res = await app.inject({
        method,
        url: '/api/_spike/echo',
        headers: {
          'x-nf-sign': token,
          'x-nf-client-connection-ip': '203.0.113.9',
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
          cookie: 'teko_spike=1; outro=valor',
        },
      })
      expect(res.statusCode).toBe(200)
      expect(res.headers['set-cookie']).toBe(SPIKE_COOKIE)
      const body = res.json()
      expect(body).toMatchObject({
        method,
        headers: {
          'x-nf-client-connection-ip': '203.0.113.9',
          'x-forwarded-for': '203.0.113.9, 10.0.0.1',
          'x-real-ip': null,
        },
        cookieNames: ['teko_spike', 'outro'],
        nfSign: { present: true, verified: true, claims: { deploy_context: 'develop' } },
      })
      expect(JSON.stringify(body)).not.toContain('valor')
    },
  )

  it('GET /api/_spike/runtime: Node, região e Sensitive só pelo tamanho', async () => {
    const res = await app.inject({ url: '/api/_spike/runtime' })
    expect(res.json()).toEqual({
      nodeVersion: 'v24.22.2',
      region: 'gru1',
      maxDurationS: 300,
      streamBudgetMs: 100_000,
      sensitive: { present: true, length: 12 },
      proxySecretConfigured: true,
    })
  })

  it('POST /api/_spike/wait-until: 202 e uma tarefa pós-resposta com teto', async () => {
    run.mockClear()
    const res = await app.inject({ method: 'POST', url: '/api/_spike/wait-until?delayMs=0' })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ delayMs: 0 })
    expect(run).toHaveBeenCalledWith('spike-wait-until', expect.any(Promise), { timeoutMs: 1000 })
    await run.mock.calls[0]?.[1]
  })
})
