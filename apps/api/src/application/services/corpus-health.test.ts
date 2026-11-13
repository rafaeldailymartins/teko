import { describe, expect, it } from 'vitest'
import type { DocumentHealth } from '../ports/corpus-ingestion-repository.ts'
import { evaluateHealth } from './corpus-health.ts'

const doc = (slug: string, overrides: Partial<DocumentHealth> = {}): DocumentHealth => ({
  slug,
  family: 'rcte',
  provisions: 100,
  chunks: 200,
  pending: 5,
  versions: 100,
  ...overrides,
})

describe('evaluateHealth', () => {
  it('sem base, só confere a fração pending', () => {
    expect(evaluateHealth(null, [doc('rcte')])).toEqual({
      documents: [{ slug: 'rcte', family: 'rcte', before: null, after: doc('rcte') }],
      families: [{ family: 'rcte', pendingShare: 0.05, pendingShareBefore: null }],
      violations: [],
    })
    expect(evaluateHealth(null, [doc('rcte', { pending: 20 })]).violations).toEqual([
      'rcte: 20.0% das redações em pending (limite 15.0%)',
    ])
  })

  it('reprova queda acima de 5% em dispositivos ou chunks e documento que sumiu', () => {
    const before = [doc('rcte'), doc('cte', { family: 'cte' })]
    expect(
      evaluateHealth(before, [
        doc('rcte', { provisions: 95, chunks: 191 }),
        before[1] as DocumentHealth,
      ]).violations,
    ).toEqual([])
    const report = evaluateHealth(before, [doc('rcte', { provisions: 94, chunks: 150 })])
    expect(report.violations).toEqual([
      'cte: sumiu do corpus publicado',
      'rcte: provisions cai de 100 para 94 (6.0% > 5.0%)',
      'rcte: chunks cai de 200 para 150 (25.0% > 5.0%)',
    ])
    expect(report.documents.find((entry) => entry.slug === 'cte')).toMatchObject({
      family: 'cte',
      after: null,
    })
  })

  it('pending acima do limite só reprova se subiu, com limite configurável', () => {
    const high = [doc('rcte', { pending: 30 })]
    expect(evaluateHealth(high, high).violations).toEqual([])
    expect(evaluateHealth(high, [doc('rcte', { pending: 31 })]).violations).toEqual([
      'rcte: 31.0% das redações em pending (limite 15.0%, antes 30.0%)',
    ])
    expect(
      evaluateHealth(high, [doc('rcte', { pending: 31 })], { maxDrop: 0.05, maxPendingShare: 0.5 })
        .violations,
    ).toEqual([])
  })

  it('documento novo e base vazia não reprovam; família sem redações tem fração 0', () => {
    const report = evaluateHealth(
      [doc('rcte', { provisions: 0, chunks: 0, versions: 0, pending: 0 })],
      [
        doc('rcte', { provisions: 0, chunks: 0, versions: 0, pending: 0 }),
        doc('cte', { family: 'cte' }),
      ],
    )
    expect(report.violations).toEqual([])
    expect(report.families).toEqual([
      { family: 'cte', pendingShare: 0.05, pendingShareBefore: null },
      { family: 'rcte', pendingShare: 0, pendingShareBefore: 0 },
    ])
  })
})
