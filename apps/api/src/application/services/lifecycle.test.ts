import { HealthStatus } from '@teko/shared/contracts'
import { describe, expect, it } from 'vitest'
import type { Clock } from '../ports/clock.ts'
import { createLifecycle } from './lifecycle.ts'

function manualClock(start: number): Clock & { advance(ms: number): void } {
  let current = start
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms
    },
  }
}

describe('createLifecycle', () => {
  it('começa saudável, sem drenagem', () => {
    const lifecycle = createLifecycle(manualClock(0))
    expect(lifecycle.status()).toBe(HealthStatus.Ok)
    expect(lifecycle.isDraining()).toBe(false)
    expect(lifecycle.drainingForMs()).toBeNull()
  })

  it('entra em drenagem uma única vez e mede o tempo desde a primeira chamada', () => {
    const clock = manualClock(1_000)
    const lifecycle = createLifecycle(clock)

    expect(lifecycle.beginDraining()).toBe(true)
    expect(lifecycle.status()).toBe(HealthStatus.Draining)
    expect(lifecycle.isDraining()).toBe(true)
    expect(lifecycle.drainingForMs()).toBe(0)

    clock.advance(2_500)
    expect(lifecycle.beginDraining()).toBe(false)
    expect(lifecycle.drainingForMs()).toBe(2_500)
    expect(lifecycle.status()).toBe(HealthStatus.Draining)
  })

  it('nunca devolve duração negativa se o relógio do sistema voltar', () => {
    const clock = manualClock(10_000)
    const lifecycle = createLifecycle(clock)
    lifecycle.beginDraining()
    clock.advance(-5_000)
    expect(lifecycle.drainingForMs()).toBe(0)
  })
})
