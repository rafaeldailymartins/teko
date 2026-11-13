import { describe, expect, it } from 'vitest'
import { createResolveReferenceDate } from './resolve-reference-date.ts'

describe('createResolveReferenceDate', () => {
  it('calcula hoje em America/Sao_Paulo pelo Clock (default = mês anterior)', () => {
    // 2026-11-01T02:00Z ainda é 31/10 em São Paulo: o default é 2026-09-01, não 2026-10-01.
    const resolve = createResolveReferenceDate({
      clock: { now: () => new Date('2026-11-01T02:00:00Z') },
    })
    expect(
      resolve({ input: { periodoApuracao: '2026-10' }, source: 'default', questionText: 'prazo?' }),
    ).toMatchObject({ kind: 'resolved', reference: { value: '2026-09-01', source: 'default' } })

    const fixed = createResolveReferenceDate({
      clock: { now: () => new Date('2026-11-10T12:00:00-03:00') },
    })
    expect(
      fixed({ input: { periodoApuracao: '2026-10' }, source: 'default', questionText: 'prazo?' }),
    ).toMatchObject({ reference: { value: '2026-10-01' } })
  })
})
