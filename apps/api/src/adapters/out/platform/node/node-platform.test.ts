import { describe, expect, it, vi } from 'vitest'
import {
  createNodeBackgroundTasks,
  createNodeClientIp,
  nodeAttachDatabasePool,
  nodeInvocationDeadline,
} from './node-platform.ts'

describe('createNodeClientIp', () => {
  const clientIp = createNodeClientIp({ trustNetlifyClientIp: false })

  it('no caminho direto usa o IP calculado com o trustProxy', () => {
    expect(
      clientIp.resolve({
        path: 'direct',
        signatureValid: false,
        headers: { 'x-real-ip': '1.1.1.1' },
        forwardedIp: '203.0.113.7',
      }),
    ).toEqual({ ip: '203.0.113.7', source: 'trusted_proxy' })
  })

  it('descarta um forwardedIp que não é IP', () => {
    expect(
      clientIp.resolve({ path: 'direct', signatureValid: false, headers: {}, forwardedIp: '' }),
    ).toEqual({ ip: null, source: 'none' })
  })

  it('no caminho proxiado segue a regra do header da Netlify', () => {
    const trusting = createNodeClientIp({ trustNetlifyClientIp: true })
    const input = {
      path: 'proxied',
      signatureValid: true,
      headers: { 'x-nf-client-connection-ip': '203.0.113.9' },
      forwardedIp: '172.30.0.2',
    } as const
    expect(trusting.resolve(input)).toEqual({ ip: '203.0.113.9', source: 'netlify_proxy' })
    expect(clientIp.resolve(input)).toEqual({ ip: null, source: 'none' })
  })
})

describe('nodeInvocationDeadline', () => {
  it('não há prazo de invocação fora da Vercel', () => {
    expect(nodeInvocationDeadline.deadlineFor(123)).toBeNull()
  })
})

describe('createNodeBackgroundTasks', () => {
  it('acompanha a tarefa e reporta falha ao observador', async () => {
    const onFailure = vi.fn()
    const tasks = createNodeBackgroundTasks(onFailure)
    tasks.run('x', Promise.reject(new Error('y')), { timeoutMs: 100 })
    expect(tasks.pending()).toBe(1)
    await tasks.drain(1_000)
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })
})

describe('nodeAttachDatabasePool', () => {
  it('não faz nada: o pool vive com o processo', () => {
    expect(nodeAttachDatabasePool({})).toBeUndefined()
  })
})
