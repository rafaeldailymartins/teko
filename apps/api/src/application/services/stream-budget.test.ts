import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createStreamBudget, STREAM_CAP_MS, STREAM_DEADLINE_RESERVE_MS } from './stream-budget.ts'

const MAX_DURATION_MS = 300_000
const vercelLike = createStreamBudget({
  deadlineFor: (startedAtMs) => startedAtMs + MAX_DURATION_MS,
})
const noDeadline = createStreamBudget({ deadlineFor: () => null })

describe('createStreamBudget', () => {
  it('sem prazo de plataforma, vale só o teto de 100 s', () => {
    expect(noDeadline.timeoutMs(0, 999_999)).toBe(STREAM_CAP_MS)
  })

  it('no começo da invocação, o teto de 100 s é menor que o prazo', () => {
    expect(vercelLike.timeoutMs(1_000, 1_000)).toBe(100_000)
  })

  it('perto do fim do prazo, desconta a reserva de 20 s', () => {
    // 300 s de prazo, 250 s já gastos: sobram 50 s − 20 s de reserva.
    expect(vercelLike.timeoutMs(0, 250_000)).toBe(30_000)
    expect(vercelLike.timeoutMs(0, 300_000 - STREAM_DEADLINE_RESERVE_MS)).toBe(0)
  })

  it('nunca devolve negativo, mesmo depois do prazo', () => {
    expect(vercelLike.timeoutMs(0, 400_000)).toBe(0)
  })

  test.prop([fc.nat({ max: 1e9 }), fc.nat({ max: 1e6 })])(
    'fica sempre entre 0 e o teto, e cai quando o tempo passa',
    (startedAtMs, elapsedMs) => {
      const now = startedAtMs + elapsedMs
      const value = vercelLike.timeoutMs(startedAtMs, now)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(STREAM_CAP_MS)
      expect(vercelLike.timeoutMs(startedAtMs, now + 1_000)).toBeLessThanOrEqual(value)
    },
  )
})
