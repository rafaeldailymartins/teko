import { test } from '@fast-check/vitest'
import {
  addDays,
  containsDate,
  createInterval,
  effectiveCoverage,
  fromEpochDay,
  toEpochDay,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CoverageStatus,
  decideCoverage,
  effectiveFamilyCoverage,
  type FamilyCoverageRecord,
} from './coverage-decision.ts'

const rcte: FamilyCoverageRecord = {
  family: 'rcte',
  jurisdiction: 'GO',
  covered: [createInterval('1998-01-01', null)],
  verifiedAt: '2026-11-10',
  gaps: [],
}
const efd: FamilyCoverageRecord = {
  family: 'efd-icms-ipi',
  jurisdiction: 'BR',
  covered: [createInterval('2025-01-01', null)],
  verifiedAt: '2026-11-10',
  gaps: [createInterval('2026-11-05', null)],
}

describe('decideCoverage', () => {
  it('todas as famílias pedidas cobrem a data', () => {
    expect(decideCoverage('2025-06-01', ['rcte', 'efd-icms-ipi'], [rcte, efd])).toMatchObject({
      status: CoverageStatus.Covered,
      coveredFamilies: ['rcte', 'efd-icms-ipi'],
      uncoveredFamilies: [],
    })
  })

  it('cobertura parcial segue só nas cobertas', () => {
    expect(decideCoverage('2006-05-01', ['rcte', 'efd-icms-ipi'], [rcte, efd])).toMatchObject({
      status: CoverageStatus.Partial,
      coveredFamilies: ['rcte'],
      uncoveredFamilies: ['efd-icms-ipi'],
    })
  })

  it('nenhuma família cobre: recusa com a cobertura efetiva de cada uma', () => {
    const decision = decideCoverage('1990-01-01', ['rcte', 'efd-icms-ipi'], [rcte, efd])
    expect(decision.status).toBe(CoverageStatus.OutOfCoverage)
    expect(decision.coverage).toEqual([
      {
        family: 'rcte',
        jurisdiction: 'GO',
        covered: [{ from: '1998-01-01', to: '2026-11-11' }],
        verifiedAt: '2026-11-10',
      },
      {
        family: 'efd-icms-ipi',
        jurisdiction: 'BR',
        covered: [{ from: '2025-01-01', to: '2026-11-05' }],
        verifiedAt: '2026-11-10',
      },
    ])
  })

  it('data posterior ao verified_at é recusada mesmo com cobertura em aberto', () => {
    expect(decideCoverage('2026-11-10', ['rcte'], [rcte]).status).toBe(CoverageStatus.Covered)
    expect(decideCoverage('2026-11-11', ['rcte'], [rcte]).status).toBe(CoverageStatus.OutOfCoverage)
  })

  it('os gaps saem da cobertura', () => {
    expect(decideCoverage('2026-11-06', ['efd-icms-ipi'], [efd]).status).toBe(
      CoverageStatus.OutOfCoverage,
    )
  })

  it('família sem registro (rcte-anexos antes da C3) conta como não coberta', () => {
    expect(decideCoverage('2020-01-01', ['rcte-anexos'], [rcte])).toEqual({
      status: CoverageStatus.OutOfCoverage,
      coveredFamilies: [],
      uncoveredFamilies: ['rcte-anexos'],
      coverage: [],
    })
  })

  it('sem famílias pedidas, considera todas as registradas (sem repetir)', () => {
    expect(decideCoverage('2006-05-01', [], [rcte, efd]).uncoveredFamilies).toEqual([
      'efd-icms-ipi',
    ])
    expect(decideCoverage('2006-05-01', ['rcte', 'rcte'], [rcte]).coveredFamilies).toEqual(['rcte'])
  })

  it('effectiveFamilyCoverage aplica verified_at e gaps', () => {
    expect(effectiveFamilyCoverage(efd).covered).toEqual([{ from: '2025-01-01', to: '2026-11-05' }])
  })
})

const START = toEpochDay('2020-01-01')
const dayArb = fc.integer({ min: START, max: START + 200 })
const dateArb = dayArb.map(fromEpochDay)
const intervalArb: fc.Arbitrary<ValidityInterval> = fc
  .tuple(dayArb, dayArb, fc.boolean())
  .filter(([a, b]) => a !== b)
  .map(([a, b, open]) =>
    createInterval(fromEpochDay(Math.min(a, b)), open ? null : fromEpochDay(Math.max(a, b))),
  )
const recordArb: fc.Arbitrary<FamilyCoverageRecord> = fc.record({
  family: fc.constant('rcte'),
  jurisdiction: fc.constant('GO' as const),
  covered: fc.array(intervalArb, { minLength: 1, maxLength: 4 }),
  verifiedAt: dateArb,
  gaps: fc.array(intervalArb, { maxLength: 2 }),
})

describe('propriedades', () => {
  test.prop([recordArb, dateArb])(
    'coberta na decisão sse a data está na cobertura efetiva',
    (record, date) => {
      const effective = effectiveCoverage(record.covered, record.verifiedAt, record.gaps)
      const covered = effective.some((interval) => containsDate(interval, date))
      const decision = decideCoverage(date, ['rcte'], [record])
      expect(decision.coveredFamilies.includes('rcte')).toBe(covered)
      expect(decision.status).toBe(covered ? CoverageStatus.Covered : CoverageStatus.OutOfCoverage)
    },
  )

  test.prop([recordArb, fc.integer({ min: 1, max: 400 })])(
    'data posterior ao verified_at nunca é coberta',
    (record, days) => {
      const after = addDays(record.verifiedAt, days)
      expect(decideCoverage(after, ['rcte'], [record]).status).toBe(CoverageStatus.OutOfCoverage)
    },
  )
})
