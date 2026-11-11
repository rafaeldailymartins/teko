import { HealthStatus } from '@teko/shared/contracts'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import type { BackgroundTasks } from '#app/ports/background-tasks.ts'
import { createLifecycle } from '#app/services/lifecycle.ts'
import { createGracefulShutdown } from './graceful-shutdown.ts'

function fakeBackgroundTasks(events: string[], abandoned: number): BackgroundTasks {
  return {
    run: () => {},
    pending: () => abandoned,
    drain: vi.fn(async (timeoutMs: number) => {
      events.push(`drain:${timeoutMs}`)
      return abandoned
    }),
  }
}

function setup(drainDelayMs: number, abandoned = 0) {
  const events: string[] = []
  const lifecycle = createLifecycle({ now: () => new Date(0) })
  const app = Fastify()
  app.addHook('onClose', async () => {
    events.push(`close:${lifecycle.status()}`)
  })
  const info = vi.spyOn(app.log, 'info')
  const warn = vi.spyOn(app.log, 'warn')
  const fatal = vi.spyOn(app.log, 'fatal')
  const container = {
    lifecycle,
    backgroundTasks: fakeBackgroundTasks(events, abandoned),
    close: vi.fn(async () => {
      events.push('container')
    }),
  }
  const wait = vi.fn(async (ms: number) => {
    events.push(`wait:${ms}`)
  })
  const shutdown = createGracefulShutdown({
    app,
    container,
    profile: { drainDelayMs, backgroundDrainMs: 300 },
    wait,
  })
  return { shutdown, events, lifecycle, info, warn, fatal, wait }
}

describe('createGracefulShutdown', () => {
  it('no SIGTERM drena, espera o proxy, fecha o servidor, as tarefas e o container', async () => {
    const { shutdown, events, lifecycle, info, warn, fatal } = setup(5000)

    await shutdown({ signal: 'SIGTERM' })

    expect(lifecycle.status()).toBe(HealthStatus.Draining)
    expect(events).toEqual([
      'wait:5000',
      `close:${HealthStatus.Draining}`,
      'drain:300',
      'container',
    ])
    expect(info).toHaveBeenCalledWith({ signal: 'SIGTERM', drainDelayMs: 5000 }, expect.any(String))
    expect(info).toHaveBeenLastCalledWith({ drainedForMs: 0 }, 'shutdown complete')
    expect(warn).not.toHaveBeenCalled()
    expect(fatal).not.toHaveBeenCalled()
  })

  it('sem atraso de drenagem (perfil da Vercel), não espera', async () => {
    const { shutdown, events, wait } = setup(0)
    await shutdown({ signal: 'SIGINT' })
    expect(wait).not.toHaveBeenCalled()
    expect(events).toEqual([`close:${HealthStatus.Draining}`, 'drain:300', 'container'])
  })

  it('avisa quando tarefas pós-resposta ficam para trás', async () => {
    const { shutdown, warn } = setup(0, 2)
    await shutdown({ signal: 'SIGTERM' })
    expect(warn).toHaveBeenCalledWith({ abandoned: 2 }, expect.any(String))
  })

  it('em erro fatal fecha imediatamente e loga como fatal', async () => {
    const { shutdown, events, fatal, wait } = setup(5000)
    const err = new Error('boom')

    await shutdown({ err })

    expect(wait).not.toHaveBeenCalled()
    expect(fatal).toHaveBeenCalledWith({ err }, expect.any(String))
    expect(events).toEqual([`close:${HealthStatus.Draining}`, 'drain:300', 'container'])
  })

  it('usa o timer real por padrão', async () => {
    const lifecycle = createLifecycle({ now: () => new Date(0) })
    const app = Fastify()
    const shutdown = createGracefulShutdown({
      app,
      container: { lifecycle, backgroundTasks: fakeBackgroundTasks([], 0), close: async () => {} },
      profile: { drainDelayMs: 1, backgroundDrainMs: 1 },
    })
    await expect(shutdown({ signal: 'SIGTERM' })).resolves.toBeUndefined()
  })
})
