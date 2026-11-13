import { describe, expect, it } from 'vitest'
import type { OpenProvisionVersion } from '../ports/corpus-ingestion-repository.ts'
import {
  CHURN_LIMITS,
  ChurnLimitError,
  type ChurnMetrics,
  churnViolations,
  measureChurn,
} from './churn.ts'

const ALL = { from: null, to: null }

function open(n: number, status: OpenProvisionVersion['reviewStatus'] = 'auto') {
  return Array.from(
    { length: n },
    (_, index): OpenProvisionVersion => ({
      id: `pv-${String(index)}`,
      stableKey: `k${String(index)}`,
      modality: 'mandatory',
      reviewStatus: status,
      contentHash: 'h',
      validDuring: { from: '2000-01-01', to: null },
    }),
  )
}

const parsed = (keys: number, pending = 0) =>
  Array.from({ length: keys }, (_, index) => ({
    stableKey: `k${String(index)}`,
    versions: [{ reviewStatus: index < pending ? ('pending' as const) : ('auto' as const) }],
  }))

const metrics = (overrides: Partial<ChurnMetrics>): ChurnMetrics => ({
  openBefore: 100,
  closed: 0,
  inserted: 0,
  provisionsBefore: 100,
  provisionsLost: 0,
  pendingShareBefore: 0,
  pendingShareAfter: 0,
  ...overrides,
})

describe('measureChurn', () => {
  it('mede fechamentos, dispositivos perdidos e a fração pending antes e depois', () => {
    const existing = [
      ...open(9),
      ...open(1, 'pending').map((row) => ({ ...row, id: 'p', stableKey: 'kp' })),
    ]
    const result = measureChurn({
      existing,
      window: ALL,
      close: ['pv-0', 'pv-1', 'p'],
      // pv-1 volta como recorte: o dispositivo k1 continua aberto.
      remainders: [{ sourceId: 'pv-1' }, { sourceId: 'sumiu' }],
      insert: 2,
      provisions: [...parsed(8, 2).slice(2), { stableKey: 'novo', versions: [] }],
    })
    expect(result).toEqual({
      openBefore: 10,
      closed: 3,
      inserted: 2,
      provisionsBefore: 10,
      // k0, k8 e kp somem; k1 fica pelo recorte.
      provisionsLost: 3,
      pendingShareBefore: 0.1,
      pendingShareAfter: 0,
    })
  })

  it('ignora as redações fora da janela e lida com conjuntos vazios', () => {
    const outside = open(3).map((row) => ({
      ...row,
      validDuring: { from: '1990-01-01', to: '1991-01-01' },
    }))
    expect(
      measureChurn({
        existing: outside,
        window: { from: '2020-01-01', to: null },
        close: [],
        remainders: [],
        insert: 0,
        provisions: [],
      }),
    ).toMatchObject({
      openBefore: 0,
      provisionsBefore: 0,
      pendingShareBefore: 0,
      pendingShareAfter: 0,
    })
  })
})

describe('churnViolations', () => {
  it('sem base suficiente, não reprova', () => {
    expect(
      churnViolations(metrics({ openBefore: CHURN_LIMITS.minBaseline - 1, closed: 19 })),
    ).toEqual([])
  })

  it('reprova fechamento acima de 20%, perda acima de 10% e pending que dobra', () => {
    expect(churnViolations(metrics({ closed: 20, provisionsLost: 10 }))).toEqual([])
    expect(
      churnViolations(
        metrics({
          closed: 21,
          provisionsLost: 11,
          pendingShareBefore: 0.05,
          pendingShareAfter: 0.1,
        }),
      ),
    ).toEqual([
      'fecha 21 de 100 redações abertas na janela (21.0% > 20.0%)',
      '11 de 100 dispositivos ficam sem redação aberta (11.0% > 10.0%)',
      'pending passa de 5.0% para 10.0% das redações',
    ])
  })

  it('pending que dobra mas sobe menos de 2 pontos não reprova', () => {
    expect(
      churnViolations(metrics({ pendingShareBefore: 0.005, pendingShareAfter: 0.012 })),
    ).toEqual([])
    expect(
      churnViolations(metrics({ pendingShareBefore: 0, pendingShareAfter: 0.03 })),
    ).toHaveLength(1)
  })

  it('o erro leva as métricas e sugere o --accept-churn', () => {
    const error = new ChurnLimitError('rcte', metrics({ closed: 50 }), ['fecha 50 de 100'])
    expect(error.message).toMatch(/^mudança em massa em rcte: fecha 50 de 100 .*--accept-churn/)
    expect(error.metrics.closed).toBe(50)
    expect(error.violations).toEqual(['fecha 50 de 100'])
  })
})
