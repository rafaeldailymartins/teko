import { describe, expect, it } from 'vitest'
import {
  addGapEntry,
  type CoverageGapEntry,
  clearResolvedGaps,
  GAP_REASON_MAX,
  mergeGapsForPromotion,
  summarizeGaps,
} from './coverage-gaps.ts'

const entry = (overrides: Partial<CoverageGapEntry> = {}): CoverageGapEntry => ({
  sources: ['guia-pratico-efd-icms-ipi'],
  from: '2026-11-10',
  to: null,
  detectedAt: '2026-11-12T09:05:00.000Z',
  reason: 'Guia 3.2.5',
  ...overrides,
})

describe('addGapEntry', () => {
  it('acrescenta uma entrada por conjunto de documentos, com os slugs ordenados', () => {
    const entries = addGapEntry(
      addGapEntry([], entry({ sources: ['b', 'a'] })),
      entry({ sources: ['notas-tecnicas-efd-icms-ipi'] }),
    )
    expect(entries.map((item) => item.sources)).toEqual([
      ['a', 'b'],
      ['notas-tecnicas-efd-icms-ipi'],
    ])
  })

  it('alarga a entrada dos mesmos documentos e mantém a detecção mais antiga', () => {
    const first = entry({ from: '2026-11-10', to: '2026-12-01' })
    const again = entry({
      from: '2026-11-05',
      to: '2026-11-20',
      detectedAt: '2026-11-13T09:00:00.000Z',
      reason: 'Guia 3.2.5 (de novo)',
    })
    expect(addGapEntry([first], again)).toEqual([
      {
        sources: ['guia-pratico-efd-icms-ipi'],
        from: '2026-11-05',
        to: '2026-12-01',
        detectedAt: '2026-11-12T09:05:00.000Z',
        reason: 'Guia 3.2.5 (de novo)',
      },
    ])
    expect(addGapEntry([entry({ detectedAt: null })], entry())[0]?.detectedAt).toBeNull()
    expect(addGapEntry([entry({ to: '2027-01-01' })], entry())[0]?.to).toBeNull()
  })
})

describe('clearResolvedGaps', () => {
  const published = (slug: string, createdAt: string) => ({ slug, createdAt })

  it('limpa só a entrada do documento publicado depois da detecção', () => {
    const guia = entry()
    const nota = entry({ sources: ['notas-tecnicas-efd-icms-ipi'], reason: 'NT 2026.004' })
    expect(
      clearResolvedGaps(
        [guia, nota],
        [published('guia-pratico-efd-icms-ipi', '2026-11-12T10:00:00Z')],
      ),
    ).toEqual([nota])
  })

  it('versão criada antes da detecção (reprocessamento por revisão do parser) não limpa', () => {
    expect(
      clearResolvedGaps(
        [entry()],
        [published('guia-pratico-efd-icms-ipi', '2026-11-01T10:00:00Z')],
      ),
    ).toHaveLength(1)
  })

  it('sem documentos, qualquer versão da família limpa; sem detecção, qualquer instante', () => {
    expect(
      clearResolvedGaps([entry({ sources: [] })], [published('rcte', '2026-11-12T10:00:00Z')]),
    ).toEqual([])
    expect(
      clearResolvedGaps(
        [entry({ detectedAt: null })],
        [published('guia-pratico-efd-icms-ipi', '2020-01-01T00:00:00Z')],
      ),
    ).toEqual([])
  })

  it('recusa instante inválido', () => {
    expect(() =>
      clearResolvedGaps([entry({ detectedAt: 'ontem' })], [published('x', 'hoje')]),
    ).not.toThrow()
    expect(() =>
      clearResolvedGaps(
        [entry({ detectedAt: 'ontem' })],
        [published('guia-pratico-efd-icms-ipi', '2026-11-12T10:00:00Z')],
      ),
    ).toThrow(RangeError)
  })
})

describe('mergeGapsForPromotion', () => {
  const exportedAt = '2026-11-12T12:00:00.000Z'

  it('adota as entradas do snapshot e solta as do destino que o staging já resolveu', () => {
    const resolved = entry({ detectedAt: '2026-11-12T09:05:00.000Z' })
    expect(mergeGapsForPromotion([], [resolved], exportedAt)).toEqual([])
    expect(mergeGapsForPromotion([], [entry({ detectedAt: null })], exportedAt)).toEqual([])
  })

  it('mantém as entradas do destino detectadas depois da exportação', () => {
    const later = entry({
      sources: ['rcte'],
      detectedAt: '2026-11-13T09:05:00.000Z',
      reason: 'Decreto',
    })
    const open = entry()
    expect(mergeGapsForPromotion([open], [later, open], exportedAt)).toEqual([open, later])
  })
})

describe('summarizeGaps', () => {
  it('soma as vigências e junta os motivos sem repetir', () => {
    expect(summarizeGaps([])).toEqual({ gaps: [], reason: null })
    expect(
      summarizeGaps([
        entry({ from: '2026-11-10', to: '2026-12-01' }),
        entry({ sources: ['x'], from: '2026-11-20', to: null, reason: 'Guia 3.2.5' }),
        entry({ sources: ['y'], from: '2025-01-01', to: '2025-02-01', reason: 'outra' }),
      ]),
    ).toEqual({
      gaps: [
        { from: '2025-01-01', to: '2025-02-01' },
        { from: '2026-11-10', to: null },
      ],
      reason: 'Guia 3.2.5; outra',
    })
  })

  it('corta o motivo no teto', () => {
    const reason = summarizeGaps([entry({ reason: 'x'.repeat(GAP_REASON_MAX + 10) })]).reason ?? ''
    expect(reason).toHaveLength(GAP_REASON_MAX)
    expect(reason.endsWith('…')).toBe(true)
  })
})
