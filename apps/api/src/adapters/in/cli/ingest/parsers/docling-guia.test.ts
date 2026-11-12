import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Family, ReviewStatus } from '#domain/corpus/family.ts'
import type { ParsedProvision, ParsedSource } from '#domain/corpus/parsed-source.ts'
import {
  makeInput,
  makeSource,
  readFixtureJson,
  type SyntheticBlock,
  syntheticDocling,
} from './docling/testing.ts'
import { GuiaReviewReason, parseDoclingGuia } from './docling-guia.ts'
import { ParseError, ParserName, type SourceDescriptor } from './parser.ts'

const SOURCE = makeSource({
  id: 'efd-icms-ipi/guia-pratico/3.2.4',
  family: Family.EfdIcmsIpi,
  parser: ParserName.DoclingGuia,
  versionLabel: 'Guia Prático EFD-ICMS/IPI versão 3.2.4 (atualização de 30/07/2026)',
  publishedOn: '2026-07-30',
  versionValidDuring: { from: '2026-01-01', to: null },
  actRef: 'Ato COTEPE/ICMS nº 44/2018',
})

const PARTS = {
  chapter: readFixtureJson('guia/guia-3-2-4-p017-018.docling.json'),
  c170: readFixtureJson('guia/guia-3-2-4-p080-081.docling.json'),
  c197: readFixtureJson('guia/guia-3-2-4-p109-111.docling.json'),
}

/** Fixture da F2 (fonte de verdade de chaves, títulos, rótulos e `structured`). */
const f2Schema = z.object({
  provisions: z.array(
    z.object({
      stableKey: z.string(),
      headingPath: z.string(),
      sortPath: z.string(),
      parent: z.string().optional(),
      versions: z.array(
        z.object({
          displayLabel: z.string(),
          structured: z.object({ tipo: z.string().optional() }).catchall(z.string()).optional(),
        }),
      ),
    }),
  ),
})
const F2 = f2Schema.parse(
  readFixtureJson(
    '../../../../../../../test/fixtures/corpus/documents/guia-pratico-efd-icms-ipi.json',
  ),
)

function byKey(source: ParsedSource, key: string): ParsedProvision {
  const provision = source.provisions.find((candidate) => candidate.stableKey === key)
  if (provision === undefined) {
    throw new Error(`dispositivo ausente: ${key}`)
  }
  return provision
}

function fieldsOf(source: ParsedSource, register: string): ParsedProvision[] {
  return source.provisions.filter((p) => p.parent === `br:efd-icms-ipi:reg:${register}`)
}

const FIELD_HEADER = ['Nº', 'Campo', 'Descrição', 'Tipo', 'Tam', 'Dec', 'Obrig']

function synthetic(blocks: readonly SyntheticBlock[], source: SourceDescriptor = SOURCE) {
  return parseDoclingGuia(makeInput(source, { docling: [syntheticDocling(blocks)] }))
}

describe('parseDoclingGuia com a saída real do Docling (Guia 3.2.4)', () => {
  // Partes fora de ordem: o parser ordena pela primeira página de cada uma.
  const parsed = parseDoclingGuia(
    makeInput(SOURCE, { docling: [PARTS.c197, PARTS.c170, PARTS.chapter] }),
  )

  it('costura a tabela do C170 que quebra entre as páginas 80 e 81: campos 01 a 38 completos', () => {
    const fields = fieldsOf(parsed, 'C170')
    expect(fields.map((field) => field.stableKey.split(':').at(-1))).toEqual(
      Array.from({ length: 38 }, (_, index) => String(index + 1).padStart(2, '0')),
    )
    expect(fields.every((field) => field.versions[0]?.reviewStatus === ReviewStatus.Auto)).toBe(
      true,
    )
    const vlItem = byKey(parsed, 'br:efd-icms-ipi:reg:C170:campo:07')
    expect(vlItem.headingPath).toBe('EFD ICMS/IPI > Bloco C > Registro C170 > Campo 07 VL_ITEM')
    expect(vlItem.sortPath).toBe('C170.07')
    expect(vlItem.versions[0]?.validDuring).toEqual({ from: '2026-01-01', to: null })
    expect(vlItem.versions[0]?.text).toMatch(/^07 VL_ITEM Valor total do item/)
  })

  it('chaves, títulos, rótulos e structured batem com a fixture da F2', () => {
    for (const register of ['C170', 'C197']) {
      const expected = F2.provisions.filter((p) =>
        p.stableKey.startsWith(`br:efd-icms-ipi:reg:${register}`),
      )
      expect(expected.length).toBeGreaterThan(1)
      for (const fixture of expected) {
        const actual = byKey(parsed, fixture.stableKey)
        const fixtureVersion = fixture.versions.at(-1)
        expect(actual.headingPath).toBe(fixture.headingPath)
        expect(actual.sortPath).toBe(fixture.sortPath)
        expect(actual.parent).toBe(fixture.parent)
        expect(actual.versions[0]?.displayLabel).toBe(fixtureVersion?.displayLabel)
        // A curadoria da F2 só guardou número e nome do C197 campo 09 (linha que quebrou de página).
        if (fixtureVersion?.structured?.tipo !== undefined) {
          expect(actual.versions[0]?.structured).toEqual(fixtureVersion.structured)
        }
      }
    }
  })

  it('o registro tem a descrição e as observações; o campo, a linha e as notas', () => {
    const c170 = byKey(parsed, 'br:efd-icms-ipi:reg:C170')
    expect(c170.kind).toBe('registro')
    expect(c170.versions[0]?.text).toMatch(/^REGISTRO C170: ITENS DO DOCUMENTO/)
    expect(c170.versions[0]?.text).toContain('\nObservações: Nível hierárquico - 3')
    const qtd = byKey(parsed, 'br:efd-icms-ipi:reg:C170:campo:05')
    expect(qtd.versions[0]?.text).toContain('\nCampo 05 (QTD) - Preenchimento')
    expect(qtd.versions[0]?.text).toContain('Validação: o valor informado no campo deve ser maior')
  })

  it('linha que quebra de página fora da tabela continua o último campo (C197, campo 09)', () => {
    const campo09 = byKey(parsed, 'br:efd-icms-ipi:reg:C197:campo:09')
    expect(campo09.versions[0]?.text).toMatch(/N 001 - OC OC 9 - Compõe o cálculo/)
    expect(campo09.versions[0]?.text).toContain('\nCampo 09 (IND_BENEFICIO) - Valores Válidos')
  })

  it('campo incluído no leiaute de 2027 (Capítulo I) estreita a vigência', () => {
    expect(byKey(parsed, 'br:efd-icms-ipi:reg:C197:campo:09').versions[0]?.validDuring).toEqual({
      from: '2027-01-01',
      to: null,
    })
    expect(parsed.stats.notesTotal).toBeGreaterThanOrEqual(1)
    expect(parsed.stats.notesToReview).toBe(0)
  })

  it('tabela órfã no começo da parte (continuação do C165) vai para o log', () => {
    expect(parsed.skipped.some((s) => s.reason === 'orphan-table')).toBe(true)
    expect(parsed.provisions.some((p) => p.stableKey.includes('C165'))).toBe(false)
  })

  it('versão de documento e janela de substituição vêm do descritor (período do leiaute)', () => {
    expect(parsed.version).toEqual({
      versionLabel: SOURCE.versionLabel,
      publishedOn: '2026-07-30',
      validDuring: { from: '2026-01-01', to: null },
      consolidatedUntil: null,
      actRef: 'Ato COTEPE/ICMS nº 44/2018',
      sha256: 'a'.repeat(64),
    })
    expect(parsed.replacementWindow).toEqual({ from: '2026-01-01', to: null })
    expect(parsed.document).toBe(SOURCE.document)
  })

  it('só a parte das páginas 80 e 81 já basta para o C170 completo', () => {
    const alone = parseDoclingGuia(makeInput(SOURCE, { docling: [PARTS.c170] }))
    expect(fieldsOf(alone, 'C170')).toHaveLength(38)
  })

  it('fora da vigência do documento (leiaute 2025): o campo de 2027 vai para revisão', () => {
    const guia319 = { ...SOURCE, versionValidDuring: { from: '2025-01-01', to: '2026-01-01' } }
    const old = parseDoclingGuia(makeInput(guia319, { docling: [PARTS.chapter, PARTS.c197] }))
    const campo09 = byKey(old, 'br:efd-icms-ipi:reg:C197:campo:09').versions[0]
    expect(campo09?.reviewStatus).toBe(ReviewStatus.Pending)
    expect(campo09?.review?.reason).toBe('outside-document-validity')
    expect(campo09?.validDuring).toEqual({ from: '2025-01-01', to: '2026-01-01' })
    expect(old.stats.notesToReview).toBeGreaterThanOrEqual(1)
  })
})

describe('parseDoclingGuia com DoclingDocument sintético', () => {
  it('costura quando o cabeçalho se repete na página seguinte', () => {
    const parsed = synthetic([
      { text: 'REGISTRO 9999: ENCERRAMENTO DO ARQUIVO DIGITAL.', label: 'section_header' },
      { table: [FIELD_HEADER, ['01', 'REG', 'Texto fixo contendo "9999"', 'C', '004', '-', 'O']] },
      {
        table: [FIELD_HEADER, ['02', 'QTD_LIN', 'Quantidade total de linhas', 'N', '-', '-', 'O']],
        page: 2,
      },
      { text: 'Observações: Nível hierárquico - 0' },
      { text: 'Campo 02 (QTD_LIN) - Validação: igual ao total de linhas.' },
    ])
    expect(fieldsOf(parsed, '9999').map((field) => field.versions[0]?.structured)).toEqual([
      {
        numero: '01',
        campo: 'REG',
        tipo: 'C',
        tamanho: '004',
        decimais: '-',
        obrigatoriedade: 'O',
      },
      {
        numero: '02',
        campo: 'QTD_LIN',
        tipo: 'N',
        tamanho: '-',
        decimais: '-',
        obrigatoriedade: 'O',
      },
    ])
    expect(byKey(parsed, 'br:efd-icms-ipi:reg:9999').versions[0]?.text).toBe(
      'REGISTRO 9999: ENCERRAMENTO DO ARQUIVO DIGITAL.\nObservações: Nível hierárquico - 0',
    )
  })

  it('título do bloco junto ao do primeiro registro (0000 nos Guias 3.1.9 a 3.2.3)', () => {
    const parsed = synthetic([
      {
        text: 'BLOCO 0: ABERTURA, IDENTIFICAÇÃO E REFERÊNCIAS REGISTRO 0000: ABERTURA DO ARQUIVO DIGITAL',
        label: 'section_header',
      },
      { table: [FIELD_HEADER, ['01', 'REG', 'Texto fixo contendo "0000"', 'C', '004', '-', 'O']] },
    ])
    expect(byKey(parsed, 'br:efd-icms-ipi:reg:0000').versions[0]?.text).toBe(
      'REGISTRO 0000: ABERTURA DO ARQUIVO DIGITAL',
    )
    expect(fieldsOf(parsed, '0000')).toHaveLength(1)
  })

  it('desfaz linhas fundidas pelo TableFormer antes da costura (C100 do Guia 3.1.9)', () => {
    const parsed = synthetic([
      { text: 'REGISTRO C100: NOTA FISCAL.' },
      {
        table: [
          FIELD_HEADER,
          ['01', 'REG', 'Texto fixo contendo "C100"', 'C', '004', '-', 'O'],
          [
            '02 03',
            'VL_DOC IND_PGTO',
            'Valor total do documento fiscal Indicador do tipo de pagamento: 0 - À vista; 1 - A prazo.',
            'N C',
            '- 001*',
            '02 -',
            'O O',
          ],
          [
            '04 05',
            'TP_LIG COD_GRUPO',
            'Tipo de Ligação 1 - Monofásico Código de grupo',
            'N C',
            '',
            '- -',
            'OC OC',
          ],
        ],
      },
    ])
    const fields = fieldsOf(parsed, 'C100')
    expect(fields.map((field) => field.versions[0]?.structured)).toEqual([
      {
        numero: '01',
        campo: 'REG',
        tipo: 'C',
        tamanho: '004',
        decimais: '-',
        obrigatoriedade: 'O',
      },
      {
        numero: '02',
        campo: 'VL_DOC',
        tipo: 'N',
        tamanho: '-',
        decimais: '02',
        obrigatoriedade: 'O',
      },
      {
        numero: '03',
        campo: 'IND_PGTO',
        tipo: 'C',
        tamanho: '001*',
        decimais: '-',
        obrigatoriedade: 'O',
      },
      {
        numero: '04',
        campo: 'TP_LIG',
        tipo: 'N',
        tamanho: '',
        decimais: '-',
        obrigatoriedade: 'OC',
      },
      {
        numero: '05',
        campo: 'COD_GRUPO',
        tipo: 'C',
        tamanho: '',
        decimais: '-',
        obrigatoriedade: 'OC',
      },
    ])
    expect(fields[1]?.versions[0]?.text).toBe('02 VL_DOC Valor total do documento fiscal N - 02 O')
    expect(fields[2]?.versions[0]?.text).toBe(
      '03 IND_PGTO Indicador do tipo de pagamento: 0 - À vista; 1 - A prazo. C 001* - O',
    )
    // A tabela passa na validação: nenhum campo vai para revisão por ela.
    expect(fields[1]?.versions[0]?.reviewStatus).toBe(ReviewStatus.Auto)
    // Dois cortes possíveis ("Ligação" e "Código") para duas linhas: a descrição fica inteira.
    expect(fields[3]?.versions[0]?.text).toContain('Tipo de Ligação 1 - Monofásico Código de grupo')
    expect(fields[3]?.versions[0]?.reviewStatus).toBe(ReviewStatus.Pending)
    expect(fields[3]?.versions[0]?.review).toEqual({
      reason: GuiaReviewReason.FieldRowMerged,
      rawNote: 'Registro C100, campo 04: descrição de linhas fundidas',
    })
  })

  it('junta a linha sem número à anterior e não costura tabela com outro número de colunas', () => {
    const parsed = synthetic([
      { text: 'REGISTRO 0990: ENCERRAMENTO DO BLOCO 0.' },
      { table: [FIELD_HEADER, ['01', 'REG', 'Texto fixo', 'C', '004', '-', 'O']] },
      { table: [['', '', 'contendo "0990"', '', '', '', '']], page: 2 },
      { table: [['02', 'QTD_LIN_0', 'Quantidade', 'N', '-', '-', 'O']], page: 2 },
      {
        table: [
          ['Código', 'Descrição'],
          ['1', 'Um'],
        ],
        page: 2,
      },
    ])
    const fields = fieldsOf(parsed, '0990')
    expect(fields).toHaveLength(2)
    expect(fields[0]?.versions[0]?.text).toBe('01 REG Texto fixo contendo "0990" C 004 - O')
    expect(fields[1]?.versions[0]?.text).toBe(
      '02 QTD_LIN_0 Quantidade N - - O Código Descrição 1 Um',
    )
  })

  it('campos fora de sequência, primeiro campo diferente de REG e tipo inválido vão para revisão', () => {
    const parsed = synthetic([
      { text: 'REGISTRO 0001: ABERTURA DO BLOCO 0.' },
      {
        table: [
          FIELD_HEADER,
          ['01', 'IND_MOV', 'Indicador', 'C', '001', '-', 'O'],
          ['03', 'X', 'Outro', 'D', '001', '-', 'O'],
          ['03', 'Y', 'Repetido', 'N', '001', '-', 'O'],
        ],
      },
    ])
    const fields = fieldsOf(parsed, '0001')
    expect(fields).toHaveLength(2)
    for (const field of fields) {
      expect(field.versions[0]?.reviewStatus).toBe(ReviewStatus.Pending)
      expect(field.versions[0]?.review?.reason).toBe(GuiaReviewReason.FieldTableInvalid)
    }
    expect(fields[0]?.versions[0]?.review?.rawNote).toMatch(/primeiro campo é IND_MOV, não REG/)
    expect(fields[0]?.versions[0]?.review?.rawNote).toMatch(/tipo "D"/)
    expect(parsed.skipped).toContainEqual(
      expect.objectContaining({
        reason: 'duplicate-field',
        stableKey: 'br:efd-icms-ipi:reg:0001:campo:03',
      }),
    )
  })

  it('registro sem tabela de campos vai para revisão; registro repetido vai para o log', () => {
    const parsed = synthetic([
      { text: 'REGISTRO 0002: CLASSIFICAÇÃO DO ESTABELECIMENTO INDUSTRIAL.' },
      { text: 'Registro sem tabela.' },
      { text: 'REGISTRO 0002: REPETIDO.' },
      { text: 'Texto ignorado.' },
      { table: [['01', 'REG']] },
    ])
    const register = byKey(parsed, 'br:efd-icms-ipi:reg:0002')
    expect(register.versions[0]?.review?.reason).toBe(GuiaReviewReason.FieldTableMissing)
    expect(register.versions[0]?.text).toBe(
      'REGISTRO 0002: CLASSIFICAÇÃO DO ESTABELECIMENTO INDUSTRIAL. Registro sem tabela.',
    )
    expect(parsed.skipped.map((s) => s.reason)).toEqual(['duplicate-register', 'orphan-table'])
  })

  it('tabela de campos que começa sem número e registros incluídos por período', () => {
    const parsed = synthetic([
      { text: 'REGISTROS INCLUÍDOS NO LEIAUTE A PARTIR DO PERÍODO DE APURAÇÃO DE JULHO DE 2026:' },
      {
        table: [
          ['Bloco', 'Descrição', 'Reg.'],
          ['0', 'Novo', '0003'],
          ['', 'sem registro', ''],
        ],
      },
      { text: 'REGISTRO 0003: NOVO REGISTRO.' },
      { table: [FIELD_HEADER, ['', 'REG', 'Texto', 'C', '004', '-', 'O']] },
    ])
    const register = byKey(parsed, 'br:efd-icms-ipi:reg:0003')
    expect(register.versions[0]?.validDuring).toEqual({ from: '2026-07-01', to: null })
    const field = fieldsOf(parsed, '0003')
    expect(field[0]?.versions[0]?.review?.rawNote).toMatch(/tabela começa sem número de campo/)
  })

  it('nota "válido a partir de" no título estreita o registro e os campos', () => {
    const parsed = synthetic([
      { text: 'REGISTRO 0004: NOVO (Válido a partir de 01/03/2026)' },
      { table: [FIELD_HEADER, ['01', 'REG', 'Texto', 'C', '004', '-', 'O']] },
      { text: 'Campo 01 (REG) - Valor Válido: [0004]' },
      { text: 'Observações: tardia vira nota.' },
    ])
    expect(byKey(parsed, 'br:efd-icms-ipi:reg:0004').versions[0]?.validDuring).toEqual({
      from: '2026-03-01',
      to: null,
    })
    const field = byKey(parsed, 'br:efd-icms-ipi:reg:0004:campo:01')
    expect(field.versions[0]?.validDuring).toEqual({ from: '2026-03-01', to: null })
    expect(field.versions[0]?.text).toBe(
      '01 REG Texto C 004 - O\nCampo 01 (REG) - Valor Válido: [0004] Observações: tardia vira nota.',
    )
  })

  it('erros de entrada viram ParseError', () => {
    expect(() =>
      parseDoclingGuia(makeInput({ ...SOURCE, family: Family.EfdReinf }, { docling: [{}] })),
    ).toThrow(ParseError)
    expect(() =>
      parseDoclingGuia(makeInput({ ...SOURCE, versionLabel: null }, { docling: [{}] })),
    ).toThrow(/versionLabel e publishedOn/)
    expect(() =>
      parseDoclingGuia(makeInput({ ...SOURCE, versionValidDuring: null }, { docling: [{}] })),
    ).toThrow(/versionValidDuring/)
    expect(() => parseDoclingGuia(makeInput(SOURCE))).toThrow(/Nenhuma saída do Docling/)
    expect(() => parseDoclingGuia(makeInput(SOURCE, { docling: [{ schema_name: 'x' }] }))).toThrow(
      /DoclingDocument inválido \(parte 1\)/,
    )
    expect(() => synthetic([{ text: 'Sem registros.' }])).toThrow(/nenhum registro/)
  })
})
