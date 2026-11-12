import { describe, expect, it } from 'vitest'
import {
  detectFieldHeader,
  FieldColumn,
  mergeContinuation,
  splitMergedRow,
  startsField,
  toFieldRow,
  validateFieldRows,
} from './field-table.ts'
import { formatBrazilianDate } from './source-version.ts'

describe('splitMergedRow (linhas fundidas pelo TableFormer)', () => {
  const header = [
    FieldColumn.Numero,
    FieldColumn.Campo,
    FieldColumn.Descricao,
    FieldColumn.Tipo,
    null,
  ] as const

  it('linha comum não é fusão', () => {
    expect(splitMergedRow(['07', 'CNPJ', 'Número', 'N', 'x'], header)).toBeNull()
    expect(splitMergedRow(['', 'contendo', '', '', ''], header)).toBeNull()
  })

  it('divide as colunas curtas, corta a descrição e deixa a coluna desconhecida na primeira linha', () => {
    expect(
      splitMergedRow(
        ['19 20', 'VL_SEG VL_OUT', 'Valor do seguro Valor de outras', 'N N', 'x'],
        header,
      ),
    ).toEqual([
      { cells: ['19', 'VL_SEG', 'Valor do seguro', 'N', 'x'], mergedDescription: false },
      { cells: ['20', 'VL_OUT', 'Valor de outras', 'N', ''], mergedDescription: false },
    ])
  })

  it('coluna curta vazia fica vazia em todas as linhas', () => {
    expect(
      splitMergedRow(['01 02', 'A B', 'Um Dois', '', ''], header)?.map((r) => r.cells[3]),
    ).toEqual(['', ''])
  })

  it('descrição sem o número exato de cortes fica inteira e marcada', () => {
    const rows = splitMergedRow(['01 02', 'A B', 'Tipo de Ligação Código', 'N C', ''], header)
    expect(rows?.map((r) => [r.cells[2], r.mergedDescription])).toEqual([
      ['Tipo de Ligação Código', true],
      ['Tipo de Ligação Código', true],
    ])
    expect(
      splitMergedRow(['01 02', 'A B', 'tudo minúsculo', 'N C', ''], header)?.[0]?.mergedDescription,
    ).toBe(true)
  })

  it('coluna curta com outra quantidade de valores não é dividida (nome quebrado no PDF)', () => {
    expect(
      splitMergedRow(['11 13', 'VL_UNIT_CON V_REST VL_X', 'Um Dois', 'N N', ''], header),
    ).toBeNull()
  })
})

describe('tabela de campos do Guia', () => {
  it('reconhece os cabeçalhos com e sem acento, com obrigatoriedade única ou por operação', () => {
    expect(detectFieldHeader(['Nº', 'Campo', 'Descrição', 'Tipo', 'Tam', 'Dec', 'Obrig'])).toEqual([
      FieldColumn.Numero,
      FieldColumn.Campo,
      FieldColumn.Descricao,
      FieldColumn.Tipo,
      FieldColumn.Tamanho,
      FieldColumn.Decimais,
      FieldColumn.Obrigatoriedade,
    ])
    expect(
      detectFieldHeader([
        'N°',
        'CAMPO',
        'DESCRICAO',
        'TIPO',
        'TAMANHO',
        'DECIMAIS',
        'ENTRADA',
        'SAIDA',
        'Extra',
      ]),
    ).toEqual([
      FieldColumn.Numero,
      FieldColumn.Campo,
      FieldColumn.Descricao,
      FieldColumn.Tipo,
      FieldColumn.Tamanho,
      FieldColumn.Decimais,
      FieldColumn.Entrada,
      FieldColumn.Saida,
      null,
    ])
    expect(detectFieldHeader(['Código', 'Descrição'])).toBeNull()
    expect(detectFieldHeader(['Registro', 'Número do Campo', 'Nome do Campo'])).toBeNull()
  })

  it('linha, continuação e campo sem coluna de decimais', () => {
    const header = detectFieldHeader(['Num', 'Campo', 'Tipo', 'Obrigatoriedade']) ?? []
    expect(startsField(['7', 'X', 'N', 'O'], header)).toBe(true)
    expect(startsField(['', 'X', 'N', 'O'], header)).toBe(false)
    expect(toFieldRow(['7', 'QUANT_BC_COF INS', 'N', 'O'], header)).toEqual({
      numero: '07',
      campo: 'QUANT_BC_COFINS',
      tipo: 'N',
      tamanho: '',
      decimais: '',
      obligations: { obrigatoriedade: 'O' },
      rowText: '7 QUANT_BC_COF INS N O',
    })
    expect(mergeContinuation(['01', 'REG', 'Texto'], ['', '', 'contínuo', 'extra'])).toEqual([
      '01',
      'REG',
      'Texto contínuo',
      'extra',
    ])
    expect(toFieldRow([], []).numero).toBe('00')
  })

  it('validação', () => {
    expect(validateFieldRows([])).toEqual(['tabela de campos vazia'])
    const header = detectFieldHeader(['Nº', 'Campo', 'Tipo']) ?? []
    expect(
      validateFieldRows([
        toFieldRow(['01', 'REG', 'C'], header),
        toFieldRow(['02', 'X', 'N'], header),
      ]),
    ).toEqual([])
  })

  it('formatBrazilianDate', () => {
    expect(formatBrazilianDate('2024-11-04')).toBe('04/11/2024')
    expect(formatBrazilianDate('x')).toBe('//x')
  })
})
