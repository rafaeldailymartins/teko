import { describe, expect, it } from 'vitest'
import { createCheckCoverage } from './check-coverage.ts'
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

describe('createCheckCoverage', () => {
  it('decide sobre a cobertura lida do repositório', async () => {
    let loads = 0
    const checkCoverage = createCheckCoverage({
      coverageRepository: {
        loadCoverage: () => {
          loads += 1
          return Promise.resolve([
            {
              family: 'rcte',
              jurisdiction: 'GO',
              covered: [{ from: '1998-01-01', to: null }],
              verifiedAt: '2026-11-10',
              gaps: [],
            },
          ])
        },
      },
    })
    await expect(checkCoverage('2006-05-01', ['rcte'])).resolves.toMatchObject({
      status: 'covered',
      coveredFamilies: ['rcte'],
    })
    await expect(checkCoverage('2026-12-01', ['rcte'])).resolves.toMatchObject({
      status: 'out_of_coverage',
    })
    expect(loads).toBe(2)
  })
})
