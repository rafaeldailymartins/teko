import { DISPLAY_TIME_ZONE } from '@teko/shared/i18n'
import { describe, expect, it } from 'vitest'
import { formatInstant, formatIsoDate, formatIsoDateRange, formatTaxPeriod } from './format.ts'

/** O ICU usa espaços especiais (U+00A0, U+2009, U+202F) em alguns formatos; aqui vira espaço. */
function plain(text: string): string {
  return text.replace(/[   ]/g, ' ')
}

describe('fuso de exibição', () => {
  it('é America/Sao_Paulo (o mesmo do timeZone do next-intl)', () => {
    expect(DISPLAY_TIME_ZONE).toBe('America/Sao_Paulo')
  })
})

describe('formatIsoDate', () => {
  it('formata por extenso em cada idioma', () => {
    expect(formatIsoDate('pt-BR', '2026-11-14')).toBe('14 de novembro de 2026')
    expect(formatIsoDate('en', '2026-11-14')).toBe('November 14, 2026')
  })

  it('formata abreviado', () => {
    expect(formatIsoDate('pt-BR', '2008-05-01', 'short')).toBe('01/05/2008')
    expect(formatIsoDate('en', '2008-05-01', 'medium')).toBe('May 1, 2008')
  })

  it('não desloca o dia pelo fuso: 1º de janeiro continua 1º de janeiro', () => {
    expect(formatIsoDate('pt-BR', '2010-01-01')).toBe('1 de janeiro de 2010')
  })

  it('aceita anos de dois dígitos sem virar 19xx', () => {
    expect(formatIsoDate('en', '0050-03-02')).toBe('March 2, 50')
  })

  it('rejeita data inválida', () => {
    expect(() => formatIsoDate('pt-BR', '2026-02-30')).toThrow()
  })
})

describe('formatIsoDateRange', () => {
  it('compacta o intervalo no formato do locale', () => {
    expect(plain(formatIsoDateRange('pt-BR', '2008-05-01', '2008-05-31'))).toBe(
      '1 – 31 de maio de 2008',
    )
    expect(plain(formatIsoDateRange('en', '2008-05-01', '2009-12-31', 'medium'))).toBe(
      'May 1, 2008 – Dec 31, 2009',
    )
  })
})

describe('formatInstant', () => {
  it('exibe no fuso de São Paulo, não no UTC', () => {
    // 02:30 UTC de 15/11 ainda é 14/11 em São Paulo (UTC−3).
    expect(plain(formatInstant('pt-BR', '2026-11-15T02:30:00Z'))).toBe('14 de nov. de 2026, 23:30')
    expect(plain(formatInstant('en', new Date('2026-11-15T02:30:00Z')))).toBe(
      'Nov 14, 2026, 11:30 PM',
    )
  })

  it('rejeita instante inválido', () => {
    expect(() => formatInstant('en', 'ontem')).toThrow(RangeError)
  })
})

describe('formatTaxPeriod', () => {
  it('numérico: MM/AAAA em qualquer idioma, aceitando as duas formas de entrada', () => {
    expect(formatTaxPeriod('pt-BR', '2024-03')).toBe('03/2024')
    expect(formatTaxPeriod('en', '05/2008')).toBe('05/2008')
  })

  it('por extenso no idioma da UI', () => {
    expect(formatTaxPeriod('pt-BR', '2024-03', 'long')).toBe('março de 2024')
    expect(formatTaxPeriod('en', '2010-01', 'long')).toBe('January 2010')
  })

  it('rejeita período inválido', () => {
    expect(() => formatTaxPeriod('pt-BR', '2024-13', 'long')).toThrow(RangeError)
  })
})
