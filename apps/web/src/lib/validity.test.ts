import { describe, expect, it } from 'vitest'
import {
  dateWithin,
  displayedVersionIndex,
  todayIsoDate,
  ValidityStatus,
  validityStatus,
  versionIndexAt,
} from './validity.ts'

/** As redações do § 6º do art. 76 do RCTE na fixture, em ordem de vigência. */
const VERSIONS = [
  { validity: { from: '2003-09-12', to: '2004-11-04' } },
  { validity: { from: '2004-11-04', to: '2009-11-23' } },
  { validity: { from: '2009-11-23', to: null } },
] as const

describe('validityStatus', () => {
  it('vigente, encerrada ou futura em relação a hoje', () => {
    const today = '2026-11-15'
    expect(validityStatus({ from: '2009-11-23', to: null }, today)).toBe(ValidityStatus.Current)
    expect(validityStatus({ from: '2004-11-04', to: '2009-11-23' }, today)).toBe(
      ValidityStatus.Superseded,
    )
    expect(validityStatus({ from: '2027-01-01', to: null }, today)).toBe(ValidityStatus.Future)
    expect(validityStatus({ from: null, to: '2026-11-15' }, today)).toBe(ValidityStatus.Superseded)
    expect(validityStatus({ from: null, to: null }, today)).toBe(ValidityStatus.Current)
  })
})

describe('versionIndexAt e displayedVersionIndex', () => {
  it('acha a redação vigente na data, com o fim exclusivo', () => {
    expect(versionIndexAt(VERSIONS, '2008-05-01')).toBe(1)
    expect(versionIndexAt(VERSIONS, '2009-11-23')).toBe(2)
    expect(versionIndexAt(VERSIONS, '2009-11-22')).toBe(1)
    expect(versionIndexAt(VERSIONS, '2000-01-01')).toBe(-1)
  })

  it('sem redação na data, mostra a anterior mais próxima ou a primeira', () => {
    const withGap = [
      { validity: { from: '2001-01-01', to: '2002-01-01' } },
      { validity: { from: '2003-01-01', to: '2004-01-01' } },
    ]
    expect(displayedVersionIndex(withGap, '2002-06-01')).toBe(0)
    expect(displayedVersionIndex(withGap, '2010-01-01')).toBe(1)
    expect(displayedVersionIndex(withGap, '1990-01-01')).toBe(0)
    expect(displayedVersionIndex(VERSIONS, '2026-11-15')).toBe(2)
    expect(displayedVersionIndex([], '2026-11-15')).toBe(-1)
    expect(
      displayedVersionIndex([{ validity: { from: null, to: '2000-01-01' } }], '2010-01-01'),
    ).toBe(0)
  })
})

describe('dateWithin', () => {
  it('o início; sem início, o último dia; sem nenhum, o fallback', () => {
    expect(dateWithin({ from: '2004-11-04', to: '2009-11-23' }, '2026-11-15')).toBe('2004-11-04')
    expect(dateWithin({ from: null, to: '2004-11-04' }, '2026-11-15')).toBe('2004-11-03')
    expect(dateWithin({ from: null, to: null }, '2026-11-15')).toBe('2026-11-15')
  })
})

describe('hoje', () => {
  it('é a data em São Paulo', () => {
    // 01:00 UTC ainda é o dia anterior em São Paulo (UTC−3).
    expect(todayIsoDate(new Date('2026-11-16T01:00:00Z'))).toBe('2026-11-15')
  })
})
