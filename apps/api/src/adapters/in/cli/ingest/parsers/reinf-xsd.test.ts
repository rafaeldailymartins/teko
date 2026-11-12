import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Family, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import { makeInput, makeSource, readFixtureBytes, readFixtureJson } from './docling/testing.ts'
import { ParseError, ParserName } from './parser.ts'
import { parseReinfXsd, patternMaxLength } from './reinf-xsd.ts'

const SOURCE = makeSource({
  id: 'efd-reinf/leiautes/2.1.2',
  family: Family.EfdReinf,
  parser: ParserName.ReinfXsd,
  versionLabel: 'Leiautes da EFD-Reinf versão 2.1.2 (ADE Cofis nº 23/2023)',
  publishedOn: '2023-03-16',
  versionValidDuring: { from: '2023-09-01', to: null },
  actRef: 'Ato Declaratório Executivo Cofis nº 23, de 10 de março de 2023',
})

const XSD = [
  'R-2010-evtTomadorServicos-v2_01_02d.xsd',
  'R-4020-evt4020PagtoBeneficiarioPJ-v2_01_02d.xsd',
  'R-4080-evt4080RetencaoRecebimento-v2_01_02d.xsd',
]

function members(names: readonly string[] = XSD): Map<string, Uint8Array> {
  return new Map(names.map((name) => [`20240930/${name}`, readFixtureBytes(`reinf/${name}`)]))
}

/** Colunas do leiaute em `structured` (as duas fontes, fixture e parser). */
const columnsSchema = z.object({
  registroPai: z.string(),
  elemento: z.string(),
  ocorrencia: z.string(),
  tipo: z.string(),
  tamanho: z.string(),
})

const fixtureSchema = z.object({
  provisions: z.array(
    z.object({
      stableKey: z.string(),
      kind: z.string(),
      parent: z.string().optional(),
      sortPath: z.string(),
      headingPath: z.string(),
      versions: z.array(
        z.object({
          displayLabel: z.string(),
          structured: columnsSchema.optional(),
          documentVersions: z.array(z.string()),
        }),
      ),
    }),
  ),
})
const F2 = fixtureSchema.parse(
  readFixtureJson('../../../../../../../test/fixtures/corpus/documents/leiautes-efd-reinf.json'),
).provisions

describe('parseReinfXsd com os XSD reais da 2.1.2 (R-2010, R-4020 e R-4080)', () => {
  const parsed = parseReinfXsd(makeInput(SOURCE, { members: members() }))
  const byKey = new Map(parsed.provisions.map((p) => [p.stableKey, p]))

  it('todo dispositivo da fixture da F2 existe, com o mesmo título, rótulo, ordem, pai e tipo', () => {
    expect(F2.length).toBe(170)
    for (const fixture of F2) {
      const actual = byKey.get(fixture.stableKey)
      expect(actual, fixture.stableKey).toBeDefined()
      expect(actual?.headingPath).toBe(fixture.headingPath)
      expect(actual?.sortPath).toBe(fixture.sortPath)
      expect(actual?.parent).toBe(fixture.parent)
      expect(actual?.kind).toBe(fixture.kind)
      expect(actual?.versions[0]?.displayLabel).toBe(fixture.versions.at(-1)?.displayLabel)
    }
  })

  it('registro pai, elemento e ocorrência batem com a fixture; tipo e tamanho em mais de 90%', () => {
    let compared = 0
    let sameTypeAndSize = 0
    for (const fixture of F2) {
      // Só as redações da 2.1.2 (a fixture omitiu a 2.1.2 dos campos ajustados por NT).
      const last = fixture.versions.at(-1)
      const expected = last?.structured
      if (expected === undefined || !last?.documentVersions.includes('reinf-2.1.2')) {
        continue
      }
      const actual = columnsSchema.parse(byKey.get(fixture.stableKey)?.versions[0]?.structured)
      compared += 1
      expect(actual.registroPai, fixture.stableKey).toBe(expected.registroPai)
      expect(actual.elemento, fixture.stableKey).toBe(expected.elemento)
      expect(actual.ocorrencia, fixture.stableKey).toBe(expected.ocorrencia)
      if (actual.tipo === expected.tipo && actual.tamanho === expected.tamanho) {
        sameTypeAndSize += 1
      }
    }
    expect(compared).toBeGreaterThan(150)
    // O XSD não distingue C de N em textos só com dígitos (CNPJ, número de processo).
    // Medido: 142 de 152.
    expect(sameTypeAndSize / compared).toBeGreaterThan(0.9)
  })

  it('texto com as colunas do leiaute, a documentação do XSD e os valores válidos', () => {
    const indRetif = byKey.get('br:efd-reinf:evt:R-4080:grupo:ideEvento:campo:indRetif')
    expect(indRetif?.versions[0]?.text).toBe(
      '5 indRetif ideEvento E N 1-1 001 - Indicativo de Retificacao\nValores válidos: 1, 2.',
    )
    const vlrBruto = byKey.get('br:efd-reinf:evt:R-4080:grupo:infoRec:campo:vlrBruto')
    expect(vlrBruto?.versions[0]?.structured).toEqual({
      registroPai: 'infoRec',
      elemento: 'E',
      tipo: 'N',
      ocorrencia: '1-1',
      tamanho: '014',
      decimais: '2',
    })
    expect(
      byKey.get('br:efd-reinf:evt:R-4080:grupo:infoRec:campo:dtFG')?.versions[0]?.structured,
    ).toMatchObject({
      tipo: 'D',
      tamanho: '-',
    })
    const event = byKey.get('br:efd-reinf:evt:R-4080')
    expect(event?.headingPath).toBe('EFD-Reinf > R-4080 - Retenção no recebimento')
    expect(event?.versions[0]?.text).toMatch(
      /^R-4080 - Retenção no recebimento\nElemento evtRetRec: /,
    )
  })

  it('vigência do período do leiaute, sem revisão, e janela de substituição = período', () => {
    for (const provision of parsed.provisions) {
      expect(provision.versions[0]?.validDuring).toEqual({ from: '2023-09-01', to: null })
      expect(provision.versions[0]?.validityBasis).toBe(ValidityBasis.LeiautePeriod)
      expect(provision.versions[0]?.reviewStatus).toBe(ReviewStatus.Auto)
    }
    expect(parsed.replacementWindow).toEqual({ from: '2023-09-01', to: null })
    expect(parsed.version.versionLabel).toBe(SOURCE.versionLabel)
  })
})

function xsd(body: string, extra = ''): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  ${extra}
  <xs:element name="Reinf"><xs:complexType><xs:sequence>
    <xs:element name="evtTeste"><xs:annotation><xs:documentation>Evento de teste</xs:documentation></xs:annotation>
      <xs:complexType>${body}<xs:attribute name="id" use="required"/></xs:complexType>
    </xs:element>
    <xs:element ref="ds:Signature"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`)
}

describe('parseReinfXsd com XSD sintéticos', () => {
  it('campo direto no evento, tipos nomeados, enumeração, atributo de grupo e choice', () => {
    const body = `<xs:sequence>
      <xs:element name="tpAmb" type="TAmb"/>
      <xs:element name="ideX" maxOccurs="unbounded"><xs:complexType>
        <xs:choice>
          <xs:element name="cpf"><xs:simpleType><xs:restriction base="xs:string"><xs:length value="11"/></xs:restriction></xs:simpleType></xs:element>
          <xs:element name="obs" minOccurs="0" type="xs:string"/>
          <xs:element name="ideY" type="TIdeY"/>
        </xs:choice>
        <xs:attribute name="seq"/>
      </xs:complexType></xs:element>
    </xs:sequence>`
    const types = `<xs:simpleType name="TAmb"><xs:restriction base="xs:unsignedByte"><xs:enumeration value="1"/><xs:enumeration value="2"/></xs:restriction></xs:simpleType>
      <xs:complexType name="TIdeY"><xs:sequence><xs:element name="valor" type="xs:decimal"/></xs:sequence></xs:complexType>`
    const parsed = parseReinfXsd(
      makeInput(SOURCE, { members: new Map([['R-9000-evtTeste-v2_01_02.xsd', xsd(body, types)]]) }),
    )
    expect(
      parsed.provisions.map((p) => [
        p.stableKey.replace('br:efd-reinf:evt:R-9000', ''),
        p.sortPath,
      ]),
    ).toEqual([
      ['', 'R-9000'],
      [':campo:tpAmb', 'R-9000.004'],
      [':grupo:ideX', 'R-9000.005'],
      [':grupo:ideX:campo:seq', 'R-9000.006'],
      [':grupo:ideX:campo:cpf', 'R-9000.007'],
      [':grupo:ideX:campo:obs', 'R-9000.008'],
      [':grupo:ideY', 'R-9000.009'],
      [':grupo:ideY:campo:valor', 'R-9000.010'],
    ])
    const [event, tpAmb, ideX, seq, cpf, obs] = parsed.provisions
    expect(event?.headingPath).toBe('EFD-Reinf > R-9000 - Exclusão de eventos')
    expect(tpAmb?.headingPath).toBe('EFD-Reinf > R-9000 - Exclusão de eventos > tpAmb')
    expect(tpAmb?.versions[0]?.displayLabel).toBe('Leiaute EFD-Reinf, evento R-9000, campo tpAmb')
    expect(tpAmb?.versions[0]?.text).toBe('4 tpAmb evtTeste E N 1-1 - -\nValores válidos: 1, 2.')
    expect(ideX?.versions[0]?.structured).toMatchObject({ elemento: 'G', ocorrencia: '1-N' })
    expect(seq?.versions[0]?.structured).toMatchObject({
      elemento: 'A',
      ocorrencia: '0-1',
      tipo: 'C',
    })
    expect(cpf?.versions[0]?.structured).toMatchObject({ tamanho: '011' })
    expect(obs?.versions[0]?.structured).toMatchObject({ ocorrencia: '0-1', tamanho: '-' })
  })

  it('evento sem título conhecido usa a documentação; grupo repetido vai para o log', () => {
    const body = `<xs:sequence>
      <xs:element name="ideA"><xs:complexType><xs:sequence><xs:element name="xx" type="xs:string"/></xs:sequence></xs:complexType></xs:element>
      <xs:element name="ideA"><xs:complexType><xs:sequence><xs:element name="yy" type="xs:string"/></xs:sequence></xs:complexType></xs:element>
    </xs:sequence>`
    const parsed = parseReinfXsd(
      makeInput(SOURCE, {
        members: new Map([
          ['R-9999-evtTeste-v2_01_02.xsd', xsd(body)],
          ['outro/R-9999-evtTeste-v2_01_03.xsd', xsd(body)],
          ['xmldsig-core-schema.xsd', new Uint8Array()],
        ]),
      }),
    )
    expect(parsed.provisions[0]?.headingPath).toBe('EFD-Reinf > R-9999 - Evento de teste')
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      'duplicate-or-invalid-key',
      'duplicate-event',
    ])
    expect(parsed.provisions.map((p) => p.stableKey.split(':').slice(4).join(':'))).toEqual([
      '',
      'grupo:ideA',
      'grupo:ideA:campo:xx',
      'grupo:ideA:campo:yy',
    ])
  })

  it('patternMaxLength', () => {
    expect(patternMaxLength('[0-9]{8}|[0-9]{14}')).toBe(14)
    expect(patternMaxLength('1|2')).toBe(1)
    expect(patternMaxLength('\\d{5}')).toBe(5)
    expect(patternMaxLength('[0-9]{1,21}')).toBe(21)
    expect(patternMaxLength('20([1-9][0-9])-(0[1-9]|1[0-2])')).toBeNull()
    expect(patternMaxLength('[0-9]+')).toBeNull()
    expect(patternMaxLength('')).toBeNull()
  })

  it('erros de entrada viram ParseError', () => {
    expect(() => parseReinfXsd(makeInput(SOURCE))).toThrow(/nenhum XSD de evento/)
    expect(() => parseReinfXsd(makeInput({ ...SOURCE, family: Family.EfdGo }))).toThrow(ParseError)
    const notXsd = new Map([['R-2010-evtX-v2_01_02.xsd', new TextEncoder().encode('<html/>')]])
    expect(() => parseReinfXsd(makeInput(SOURCE, { members: notXsd }))).toThrow(/não é um XSD/)
    const noEvent = new Map([
      [
        'R-2010-evtX-v2_01_02.xsd',
        new TextEncoder().encode('<xs:schema><xs:element name="Outro"/></xs:schema>'),
      ],
    ])
    expect(() => parseReinfXsd(makeInput(SOURCE, { members: noEvent }))).toThrow(
      /sem o elemento Reinf/,
    )
  })
})
