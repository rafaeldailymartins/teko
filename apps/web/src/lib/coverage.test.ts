import type { FamilyCoverage } from '@teko/shared/contracts'
import { describe, expect, it } from 'vitest'
import {
  coverageGaps,
  coverageScale,
  coverageSegments,
  familyMessageKey,
  groupByJurisdiction,
  lastVerification,
  SegmentKind,
} from './coverage.ts'

function family(overrides: Partial<FamilyCoverage> & Pick<FamilyCoverage, 'family'>) {
  return {
    jurisdiction: 'GO',
    covered: [{ from: '2000-01-01', to: '2026-11-11' }],
    verifiedAt: '2026-11-10',
    ...overrides,
  } satisfies FamilyCoverage
}

describe('familyMessageKey', () => {
  it('mapeia o slug para a chave do catálogo e devolve null para família desconhecida', () => {
    expect(familyMessageKey('efd-icms-ipi')).toBe('efdIcmsIpi')
    expect(familyMessageKey('rcte-anexos')).toBe('rcteAnexos')
    expect(familyMessageKey('nova-familia')).toBeNull()
    expect(familyMessageKey('toString')).toBeNull()
  })
})

describe('coverageGaps', () => {
  it('são os trechos entre dois períodos cobertos', () => {
    expect(
      coverageGaps([
        { from: '2015-01-01', to: '2026-11-11' },
        { from: '1998-01-01', to: '2010-01-01' },
      ]),
    ).toEqual([{ from: '2010-01-01', to: '2015-01-01' }])
  })

  it('períodos contíguos ou um só período não têm lacuna', () => {
    expect(
      coverageGaps([
        { from: '1998-01-01', to: '2010-01-01' },
        { from: '2010-01-01', to: null },
      ]),
    ).toEqual([])
    expect(coverageGaps([{ from: null, to: '2026-11-11' }])).toEqual([])
    expect(coverageGaps([])).toEqual([])
  })
})

describe('lastVerification', () => {
  it('é a verificação mais recente entre as famílias', () => {
    expect(
      lastVerification([
        family({ family: 'rcte', verifiedAt: '2026-11-01' }),
        family({ family: 'cte', verifiedAt: '2026-11-10' }),
        family({ family: 'efd-go', verifiedAt: '2026-10-30' }),
      ]),
    ).toBe('2026-11-10')
    expect(lastVerification([])).toBeNull()
  })
})

describe('groupByJurisdiction', () => {
  it('põe as federais antes das de Goiás e omite grupo vazio', () => {
    const groups = groupByJurisdiction([
      family({ family: 'rcte' }),
      family({ family: 'efd-icms-ipi', jurisdiction: 'BR' }),
      family({ family: 'cte' }),
    ])
    expect(groups.map((group) => group.jurisdiction)).toEqual(['BR', 'GO'])
    expect(groups[1]?.families.map((item) => item.family)).toEqual(['rcte', 'cte'])
    expect(groupByJurisdiction([family({ family: 'rcte' })]).map((g) => g.jurisdiction)).toEqual([
      'GO',
    ])
  })
})

describe('coverageScale', () => {
  it('vai do começo mais antigo ao dia seguinte à última verificação', () => {
    expect(
      coverageScale([
        family({ family: 'rcte', covered: [{ from: '1998-01-01', to: '2026-11-11' }] }),
        family({ family: 'cte', covered: [{ from: '1997-01-01', to: '2026-11-11' }] }),
      ]),
    ).toEqual({ from: '1997-01-01', to: '2026-11-11' })
  })

  it('sem começo conhecido ou sem famílias, não há escala', () => {
    expect(coverageScale([])).toBeNull()
    expect(
      coverageScale([family({ family: 'rcte', covered: [{ from: null, to: '2026-11-11' }] })]),
    ).toBeNull()
    expect(coverageScale([family({ family: 'rcte', covered: [] })])).toBeNull()
  })

  it('começo depois da verificação não forma escala', () => {
    expect(
      coverageScale([
        family({
          family: 'rcte',
          covered: [{ from: '2027-01-01', to: null }],
          verifiedAt: '2026-11-10',
        }),
      ]),
    ).toBeNull()
  })
})

describe('coverageSegments', () => {
  const scale = { from: '2000-01-01', to: '2000-01-11' }

  it('converte cobertura e lacunas em porcentagens da escala, em ordem', () => {
    expect(
      coverageSegments(
        [
          { from: '2000-01-06', to: '2000-01-11' },
          { from: '2000-01-01', to: '2000-01-03' },
        ],
        scale,
      ),
    ).toEqual([
      { kind: SegmentKind.Covered, start: 0, width: 20 },
      { kind: SegmentKind.Gap, start: 20, width: 30 },
      { kind: SegmentKind.Covered, start: 50, width: 50 },
    ])
  })

  it('corta o que sai da escala e descarta trecho vazio', () => {
    expect(coverageSegments([{ from: null, to: null }], scale)).toEqual([
      { kind: SegmentKind.Covered, start: 0, width: 100 },
    ])
    expect(coverageSegments([{ from: '2001-01-01', to: null }], scale)).toEqual([])
  })
})
