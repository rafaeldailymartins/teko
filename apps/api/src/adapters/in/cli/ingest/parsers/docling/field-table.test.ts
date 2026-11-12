import { describe, expect, it } from 'vitest'
import {
  detectFieldHeader,
  FieldColumn,
  mergeContinuation,
  startsField,
  toFieldRow,
  validateFieldRows,
} from './field-table.ts'
import { formatBrazilianDate } from './source-version.ts'

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
