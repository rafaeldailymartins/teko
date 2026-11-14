import { describe, expect, it } from 'vitest'
import { ANCESTORS_BUDGET_CHARS, type Evidence, isValidAt, maxRrf, rerankText } from './evidence.ts'

function evidence(rrf: number, from: string, to: string | null): Evidence {
  return {
    chunkId: 'c',
    stableKey: 'go:rcte:art:76:par:6',
    family: 'rcte',
    citationLabel: 'RCTE, art. 76, § 6º',
    headingPath: 'RCTE > Art. 76',
    ancestors: [],
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

  describe('rerankText', () => {
    const base = evidence(0.03, '2024-04-01', null)

    it('caminho de títulos, ancestrais da raiz ao pai e o conteúdo', () => {
      const item: Evidence = {
        ...base,
        headingPath: 'RCTE > Art. 20 > inciso I',
        ancestors: ['Art. 20. As alíquotas do imposto são:'],
        content: 'I - 19% (dezenove por cento), nas operações e prestações internas;',
      }
      expect(rerankText(item)).toBe(
        [
          'RCTE > Art. 20 > inciso I',
          'Art. 20. As alíquotas do imposto são:',
          'I - 19% (dezenove por cento), nas operações e prestações internas;',
        ].join('\n'),
      )
    })

    it('sem ancestrais, só o caminho e o conteúdo', () => {
      expect(rerankText(base)).toBe('RCTE > Art. 76\n§ 6º ...')
    })

    it('ancestral longo vira trecho com espaços colapsados, cortado em fim de palavra', () => {
      const long = `Art. 1º   ${'palavra '.repeat(60)}`
      const [, piece] = rerankText({ ...base, ancestors: [long] }).split('\n')
      expect(piece?.endsWith('…')).toBe(true)
      expect(piece?.length).toBeLessThanOrEqual(201)
      expect(piece).not.toContain('  ')
      expect(piece?.slice(0, -1).endsWith('palavra')).toBe(true)
    })

    it('texto sem espaço é cortado no limite', () => {
      const [, piece] = rerankText({ ...base, ancestors: ['x'.repeat(500)] }).split('\n')
      expect(piece).toBe(`${'x'.repeat(200)}…`)
    })

    it('teto de contexto: guarda os mais próximos, na ordem de leitura, e pula os vazios', () => {
      const ancestors = ['a'.repeat(190), 'b'.repeat(190), '   ', 'c'.repeat(190), 'd'.repeat(190)]
      const lines = rerankText({ ...base, ancestors }).split('\n')
      expect(lines.slice(1, -1)).toEqual(['b'.repeat(190), 'c'.repeat(190), 'd'.repeat(190)])
      expect(lines.slice(1, -1).join('').length).toBeLessThanOrEqual(ANCESTORS_BUDGET_CHARS)
    })
  })
})
