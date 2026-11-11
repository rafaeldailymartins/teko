import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createVercelBackgroundTasks,
  createVercelClientIp,
  createVercelInvocationDeadline,
  vercelAttachDatabasePool,
} from './vercel-platform.ts'

/** Contexto de requisição que o runtime da Vercel publica no `globalThis` (`@vercel/functions`). */
const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

afterEach(() => {
  Reflect.deleteProperty(globalThis, REQUEST_CONTEXT)
})

describe('createVercelClientIp', () => {
  const clientIp = createVercelClientIp({ trustNetlifyClientIp: false })

  it('no caminho direto usa o x-real-ip da borda, não o forwardedIp', () => {
    expect(
      clientIp.resolve({
        path: 'direct',
        signatureValid: false,
        headers: { 'x-real-ip': '203.0.113.7' },
        forwardedIp: '127.0.0.1',
      }),
    ).toEqual({ ip: '203.0.113.7', source: 'platform' })
  })

  it.each([undefined, 'lixo', ['1.1.1.1', '2.2.2.2']])(
    'sem x-real-ip válido (%j), nenhum IP',
    (value) => {
      expect(
        clientIp.resolve({
          path: 'direct',
          signatureValid: false,
          headers: { 'x-real-ip': value },
          forwardedIp: '127.0.0.1',
        }),
      ).toEqual({ ip: null, source: 'none' })
    },
  )

  it('no caminho proxiado ignora o x-real-ip (é o IP de saída da Netlify)', () => {
    const input = {
      path: 'proxied',
      signatureValid: true,
      headers: { 'x-real-ip': '198.51.100.1', 'x-nf-client-connection-ip': '203.0.113.9' },
      forwardedIp: '198.51.100.1',
    } as const
    expect(clientIp.resolve(input)).toEqual({ ip: null, source: 'none' })
    expect(createVercelClientIp({ trustNetlifyClientIp: true }).resolve(input)).toEqual({
      ip: '203.0.113.9',
      source: 'netlify_proxy',
    })
  })
})

describe('createVercelInvocationDeadline', () => {
  it('prazo = início + maxDuration configurado (substitui o getDeadline)', () => {
    expect(createVercelInvocationDeadline(300_000).deadlineFor(1_000)).toBe(301_000)
  })
})

describe('createVercelBackgroundTasks', () => {
  it('entrega cada tarefa ao waitUntil da invocação corrente', async () => {
    const waitUntil = vi.fn()
    Reflect.set(globalThis, REQUEST_CONTEXT, { get: () => ({ waitUntil }) })

    const tasks = createVercelBackgroundTasks(() => {})
    tasks.run('flush', Promise.resolve(), { timeoutMs: 100 })

    expect(waitUntil).toHaveBeenCalledTimes(1)
    await tasks.drain(1_000)
  })

  it('fora de uma invocação da Vercel, só acompanha a promise', async () => {
    const onFailure = vi.fn()
    const tasks = createVercelBackgroundTasks(onFailure)
    tasks.run('flush', Promise.reject(new Error('x')), { timeoutMs: 100 })
    await expect(tasks.drain(1_000)).resolves.toBe(0)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('aceita outro gancho de ciclo de vida (testes)', () => {
    const extend = vi.fn()
    createVercelBackgroundTasks(() => {}, extend).run('x', Promise.resolve(), { timeoutMs: 10 })
    expect(extend).toHaveBeenCalledTimes(1)
  })
})

describe('vercelAttachDatabasePool', () => {
  it('entrega o pool ao gancho da plataforma', () => {
    const attach = vi.fn()
    const pool = { options: { idleTimeoutMillis: 5000 }, on: vi.fn() }
    vercelAttachDatabasePool(pool, attach)
    expect(attach).toHaveBeenCalledWith(pool)
  })

  it('com o attachDatabasePool real, fora de uma invocação da Vercel, não falha', () => {
    expect(() =>
      vercelAttachDatabasePool({ options: { idleTimeoutMillis: 5000 }, on: vi.fn() }),
    ).not.toThrow()
  })
})
