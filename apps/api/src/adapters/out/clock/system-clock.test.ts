import { describe, expect, it } from 'vitest'
import { systemClock } from './system-clock.ts'

describe('systemClock', () => {
  it('devolve o instante atual em um Date novo a cada chamada', () => {
    const before = Date.now()
    const first = systemClock.now()
    const second = systemClock.now()
    const after = Date.now()

    expect(first.getTime()).toBeGreaterThanOrEqual(before)
    expect(second.getTime()).toBeLessThanOrEqual(after)
    expect(first).not.toBe(second)
  })
})
