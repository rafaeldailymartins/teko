import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Family, Modality, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import {
  makeInput,
  makeSource,
  readFixtureJson,
  type SyntheticBlock,
  syntheticDocling,
} from './docling/testing.ts'
import { ntSegmentValue, parseDoclingGeneric } from './docling-generic.ts'
import { ParseError, ParserName, type SourceDescriptor } from './parser.ts'

const GO_SOURCE = makeSource({
  id: 'efd-go/guia-pratico/5.9',
  family: Family.EfdGo,
  parser: ParserName.DoclingGeneric,
  versionLabel: 'Guia Prático da EFD de Goiás versão 5.9 (atualização de 16/03/2026)',
  publishedOn: '2026-03-16',
  versionValidDuring: { from: '2026-03-16', to: null },
})

const GO_PARTS = [
  readFixtureJson('efd-go/guia-go-5-9-p026-029.docling.json'),
  readFixtureJson('efd-go/guia-go-5-9-p003.docling.json'),
]

const fixtureSchema = z.object({
  provisions: z.array(
    z.object({
      stableKey: z.string(),
      sortPath: z.string(),
      headingPath: z.string(),
      versions: z.array(z.object({ displayLabel: z.string(), text: z.string() })),
    }),
  ),
})
const F2 = fixtureSchema.parse(
  readFixtureJson(
    '../../../../../../../test/fixtures/corpus/documents/guia-pratico-efd-goias.json',
  ),
).provisions

describe('parseDoclingGeneric com o Guia EFD-GO 5.9 (saída real do Docling)', () => {
  const parsed = parseDoclingGeneric(makeInput(GO_SOURCE, { docling: GO_PARTS }))
  const byKey = new Map(parsed.provisions.map((p) => [p.stableKey, p]))

  it('um tópico por título numerado, sem o sumário e sem o ruído de página', () => {
    expect(parsed.provisions.map((p) => p.stableKey)).toEqual([
      'go:efd-go:item:1-3',
      'go:efd-go:item:1-3-1',
      'go:efd-go:item:1-4',
      'go:efd-go:item:1-5',
      'go:efd-go:item:2',
      'go:efd-go:item:2-1',
    ])
    expect(byKey.get('go:efd-go:item:1-3-1')?.parent).toBe('go:efd-go:item:1-3')
    expect(byKey.get('go:efd-go:item:2-1')?.parent).toBe('go:efd-go:item:2')
    expect(byKey.get('go:efd-go:item:1-3')?.parent).toBeUndefined()
    const text = byKey.get('go:efd-go:item:1-3-1')?.versions[0]?.text ?? ''
    expect(text).not.toMatch(/____|ECONOMIA\/GO|GUIA PRÁTICO DA ESCRITURAÇÃO/)
    expect(text).toContain('GO000158 Restituição do PROTEGE')
  })

  it('chaves, títulos, ordem e rótulos batem com a fixture da F2 (1.3, 1.4 e 1.5)', () => {
    for (const key of ['go:efd-go:item:1-3', 'go:efd-go:item:1-4', 'go:efd-go:item:1-5']) {
      const fixture = F2.find((p) => p.stableKey === key)
      const actual = byKey.get(key)
      expect(actual?.headingPath).toBe(fixture?.headingPath)
      expect(actual?.sortPath).toBe(fixture?.sortPath)
      expect(actual?.kind).toBe('topico')
      expect(actual?.versions[0]?.displayLabel).toBe(fixture?.versions[0]?.displayLabel)
    }
    expect(byKey.get('go:efd-go:item:1-4')?.versions[0]?.text).toMatch(
      /^1\.4 FUNDEINFRA\nOs contribuintes que utilizam benefícios fiscais sujeitos à contribuição do FUNDEINFRA/,
    )
  })

  it('vigência [publicação, próxima publicação), publication_approx, sem revisão', () => {
    for (const provision of parsed.provisions) {
      expect(provision.versions).toHaveLength(1)
      expect(provision.versions[0]).toMatchObject({
        validDuring: { from: '2026-03-16', to: null },
        validityBasis: ValidityBasis.PublicationApprox,
        modality: Modality.Mandatory,
        reviewStatus: ReviewStatus.Auto,
      })
    }
    expect(parsed.replacementWindow).toEqual({ from: '2026-03-16', to: null })
    expect(parsed.version.validDuring).toEqual({ from: '2026-03-16', to: null })
  })
})

const NT_SOURCE = makeSource({
  id: 'efd-icms-ipi/nt/2025-001',
  family: Family.EfdIcmsIpi,
  parser: ParserName.DoclingGeneric,
  versionLabel: 'Nota Técnica EFD ICMS IPI nº 2025.001',
  publishedOn: '2025-06-01',
  versionValidDuring: { from: '2025-07-01', to: '2027-01-01' },
  optionalFrom: '2025-07-01',
  mandatoryFrom: '2026-01-01',
  effectiveFrom: null,
  actRef: 'Ato COTEPE/ICMS nº 44/2018',
})

function nt(blocks: readonly SyntheticBlock[], source: SourceDescriptor = NT_SOURCE) {
  return parseDoclingGeneric(makeInput(source, { docling: [syntheticDocling(blocks)] }))
}

describe('parseDoclingGeneric com Notas Técnicas (DoclingDocument sintético)', () => {
  const blocks: SyntheticBlock[] = [
    { text: 'NOTA TÉCNICA 2025.001', label: 'title' },
    { text: 'Sumário', label: 'section_header' },
    { text: '1. Introdução ........ 3', label: 'section_header' },
    { text: '1. Introdução', label: 'section_header' },
    { text: 'Texto da introdução.' },
    { text: '2 Alterações no leiaute', label: 'section_header' },
    {
      table: [
        ['Registro', 'Campo'],
        ['C197', 'IND_BENEFICIO'],
      ],
    },
    { text: '2.1 Registro C197', label: 'section_header' },
    { text: 'Inclusão do campo 09.' },
    { text: '1. Introdução', label: 'section_header' },
    { text: 'Repetição descartada.' },
    { text: '3 Vigência', label: 'section_header', page: 2 },
  ]

  it('tópicos com chave por NT, versões facultativa e obrigatória e legal_effect', () => {
    const parsed = nt(blocks)
    expect(parsed.provisions.map((p) => [p.stableKey, p.parent, p.sortPath])).toEqual([
      ['br:efd-icms-ipi:nt:2025-001:item:1', undefined, '001'],
      ['br:efd-icms-ipi:nt:2025-001:item:2', undefined, '002'],
      ['br:efd-icms-ipi:nt:2025-001:item:2-1', 'br:efd-icms-ipi:nt:2025-001:item:2', '002.001'],
      ['br:efd-icms-ipi:nt:2025-001:item:3', undefined, '003'],
    ])
    const item2 = parsed.provisions[1]
    expect(item2?.headingPath).toBe(
      'Nota Técnica EFD ICMS IPI nº 2025.001 > 2 Alterações no leiaute',
    )
    expect(
      item2?.versions.map((v) => [v.modality, v.validDuring, v.validityBasis, v.retroactive]),
    ).toEqual([
      [
        Modality.Optional,
        { from: '2025-07-01', to: '2026-01-01' },
        ValidityBasis.LegalEffect,
        false,
      ],
      [
        Modality.Mandatory,
        { from: '2026-01-01', to: '2027-01-01' },
        ValidityBasis.LegalEffect,
        false,
      ],
    ])
    expect(item2?.versions[0]?.text).toBe(
      '2 Alterações no leiaute\nRegistro Campo\nC197 IND_BENEFICIO',
    )
    expect(item2?.versions[0]?.displayLabel).toBe('Nota Técnica EFD ICMS IPI nº 2025.001, item 2')
    expect(parsed.skipped).toEqual([
      { stableKey: null, reason: 'duplicate-topic', rawNote: '1. Introdução' },
    ])
    expect(parsed.replacementWindow).toEqual({ from: '2025-07-01', to: '2027-01-01' })
    expect(parsed.version).toMatchObject({
      publishedOn: '2025-06-01',
      validDuring: { from: '2025-07-01', to: '2027-01-01' },
    })
  })

  it('NT retroativa da REINF, sem tópicos numerados: um dispositivo só', () => {
    const parsed = nt([{ text: 'Ajustes nos campos do R-4020.' }], {
      ...NT_SOURCE,
      id: 'efd-reinf/nt/05-2026',
      family: Family.EfdReinf,
      versionLabel: 'Nota Técnica EFD-Reinf nº 05/2026',
      optionalFrom: null,
      mandatoryFrom: null,
      effectiveFrom: '2025-01-01',
      versionValidDuring: null,
    })
    expect(parsed.provisions).toEqual([
      expect.objectContaining({
        stableKey: 'br:efd-reinf:nt:2026-005',
        kind: 'nota-tecnica',
        headingPath: 'Nota Técnica EFD-Reinf nº 05/2026',
      }),
    ])
    expect(parsed.provisions[0]?.versions[0]).toMatchObject({
      validDuring: { from: '2025-01-01', to: null },
      retroactive: true,
      modality: Modality.Mandatory,
    })
  })

  it('NT cuja próxima versão chega antes da obrigatoriedade vai para revisão', () => {
    const parsed = nt([{ text: '1 Único', label: 'section_header' }], {
      ...NT_SOURCE,
      optionalFrom: null,
      versionValidDuring: { from: '2025-07-01', to: '2025-12-01' },
    })
    expect(parsed.provisions[0]?.versions).toEqual([
      expect.objectContaining({
        validDuring: { from: '2025-07-01', to: '2025-12-01' },
        reviewStatus: ReviewStatus.Pending,
        review: expect.objectContaining({ reason: 'nt-empty-mandatory' }),
      }),
    ])
    const noWindow = nt([{ text: '1 Único', label: 'section_header' }], {
      ...NT_SOURCE,
      optionalFrom: null,
      mandatoryFrom: '2026-01-01',
      versionValidDuring: null,
      publishedOn: '2026-02-01',
      effectiveFrom: '2026-03-01',
    })
    expect(noWindow.provisions[0]?.versions[0]?.validDuring).toEqual({
      from: '2026-01-01',
      to: null,
    })
  })

  it('erros de entrada viram ParseError', () => {
    expect(() => nt([], { ...NT_SOURCE, versionLabel: null })).toThrow(/versionLabel e publishedOn/)
    expect(() => nt([], { ...NT_SOURCE, id: 'efd-icms-ipi/nt/sem-numero' })).toThrow(/número da NT/)
    expect(() => nt([], { ...NT_SOURCE, id: 'efd-icms-ipi/nt/2025-0000001' })).toThrow(
      /número da NT/,
    )
    expect(() => nt([], { ...NT_SOURCE, family: Family.Rcte })).toThrow(ParseError)
    expect(ntSegmentValue('2025.1')).toBe('2025-001')
    expect(ntSegmentValue('05/2026')).toBe('2026-005')
    expect(ntSegmentValue('2025001')).toBeNull()
    expect(() => nt([{ text: 'só preâmbulo' }], GO_SOURCE)).toThrow(/nenhum tópico numerado/)
    expect(() => nt([{ text: '____' }])).toThrow(/nenhum tópico numerado/)
  })
})
