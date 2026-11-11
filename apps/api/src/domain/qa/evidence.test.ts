import { describe, expect, it } from 'vitest'
import { type Evidence, isValidAt, maxRrf } from './evidence.ts'

function evidence(rrf: number, from: string, to: string | null): Evidence {
  return {
    chunkId: 'c',
    stableKey: 'go:rcte:art:76:par:6',
    family: 'rcte',
    citationLabel: 'RCTE, art. 76, § 6º',
    content: '§ 6º ...',
    validity: { from, to },
    document: { versionId: 'v', versionLabel: 'RCTE 2026', title: 'RCTE', sourceUrl: 'https://x' },
    rrf,
    lexicalRank: 1,
    semanticRank: null,
    referenceRank: null,
  }
}

describe('evidence', () => {
  it('isValidAt usa [from, to)', () => {
    const item = evidence(0.03, '2004-11-04', '2009-11-23')
    expect(isValidAt(item, '2006-05-01')).toBe(true)
    expect(isValidAt(item, '2004-11-04')).toBe(true)
    expect(isValidAt(item, '2009-11-23')).toBe(false)
    expect(isValidAt(evidence(0, '2009-11-23', null), '2026-11-10')).toBe(true)
  })

  it('maxRrf é o maior RRF, ou 0 sem evidência', () => {
    expect(maxRrf([])).toBe(0)
    expect(maxRrf([evidence(0.02, '2020-01-01', null), evidence(0.05, '2020-01-01', null)])).toBe(
      0.05,
    )
  })
})
