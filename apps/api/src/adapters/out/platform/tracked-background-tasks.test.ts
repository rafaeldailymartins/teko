import { describe, expect, it, vi } from 'vitest'
import type { BackgroundTaskFailure } from '#app/ports/background-tasks.ts'
import { createTrackedBackgroundTasks } from './tracked-background-tasks.ts'

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createTrackedBackgroundTasks', () => {
  it('acompanha a tarefa até terminar e não reporta sucesso', async () => {
    const failures: BackgroundTaskFailure[] = []
    const tasks = createTrackedBackgroundTasks({ onFailure: (f) => failures.push(f) })
    const gate = deferred()

    tasks.run('flush', gate.promise, { timeoutMs: 1_000 })
    expect(tasks.pending()).toBe(1)

    gate.resolve()
    await expect(tasks.drain(1_000)).resolves.toBe(0)
    expect(tasks.pending()).toBe(0)
    expect(failures).toEqual([])
  })

  it('reporta erro sem rejeitar', async () => {
    const onFailure = vi.fn()
    const tasks = createTrackedBackgroundTasks({ onFailure })
    const error = new Error('exporter down')

    tasks.run('otel', Promise.reject(error), { timeoutMs: 1_000 })
    await tasks.drain(1_000)

    expect(onFailure).toHaveBeenCalledWith({ name: 'otel', outcome: 'failed', error })
  })

  it('reporta estouro do teto e libera o registro', async () => {
    const onFailure = vi.fn()
    const tasks = createTrackedBackgroundTasks({ onFailure })

    tasks.run('langfuse', new Promise(() => {}), { timeoutMs: 5 })
    await tasks.drain(1_000)

    expect(onFailure).toHaveBeenCalledWith({ name: 'langfuse', outcome: 'timed_out' })
    expect(tasks.pending()).toBe(0)
  })

  it('drain devolve quantas ficaram pendentes quando o teto do drain acaba antes', async () => {
    const tasks = createTrackedBackgroundTasks({ onFailure: () => {} })
    tasks.run('lenta', new Promise(() => {}), { timeoutMs: 60_000 })
    await expect(tasks.drain(5)).resolves.toBe(1)
  })

  it('drain sem tarefas resolve na hora', async () => {
    const tasks = createTrackedBackgroundTasks({ onFailure: () => {} })
    await expect(tasks.drain(0)).resolves.toBe(0)
  })

  it('entrega a promise já contida ao gancho da plataforma', async () => {
    const extendLifetime = vi.fn()
    const tasks = createTrackedBackgroundTasks({ onFailure: () => {}, extendLifetime })

    tasks.run('flush', Promise.reject(new Error('x')), { timeoutMs: 1_000 })

    expect(extendLifetime).toHaveBeenCalledTimes(1)
    const [settled] = extendLifetime.mock.lastCall ?? []
    await expect(settled).resolves.toBeUndefined()
  })

  it('um observador que lança não derruba a tarefa', async () => {
    const tasks = createTrackedBackgroundTasks({
      onFailure: () => {
        throw new Error('logger quebrado')
      },
    })
    tasks.run('x', Promise.reject(new Error('y')), { timeoutMs: 1_000 })
    await expect(tasks.drain(1_000)).resolves.toBe(0)
  })
})
