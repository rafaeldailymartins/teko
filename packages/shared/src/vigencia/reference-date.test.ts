import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { anyIsoDateArb } from '../../test/arbitraries.ts'
import { toEpochDay } from './iso-date.ts'
import {
  formatPeriodoApuracao,
  isPeriodoApuracao,
  parsePeriodoApuracao,
  periodoApuracaoInterval,
  periodoApuracaoOf,
  periodoApuracaoStart,
  shiftPeriodoApuracao,
} from './periodo-apuracao.ts'
import {
  defaultReferenceDate,
  hasBoundaryInsidePeriod,
  ReferenceSource,
  referenceDateFromInput,
} from './reference-date.ts'
import { containsDate, createInterval } from './validity-interval.ts'

describe('período de apuração', () => {
  it('aceita AAAA-MM e MM/AAAA e devolve a forma canônica', () => {
    expect(parsePeriodoApuracao('2024-03')).toBe('2024-03')
    expect(parsePeriodoApuracao('03/2024')).toBe('2024-03')
    expect(parsePeriodoApuracao(' 12/1997 ')).toBe('1997-12')
  })

  it.each([
    '2024-13',
    '13/2024',
    '00/2024',
    '2024-00',
    '2024-3',
    '3/2024',
    '0000-01',
    '2024/03',
    '03-2024',
    '',
  ])('rejeita %j', (value) => {
    expect(() => parsePeriodoApuracao(value)).toThrow(RangeError)
  })

  it('reconhece apenas a forma canônica', () => {
    expect(isPeriodoApuracao('2024-03')).toBe(true)
    expect(isPeriodoApuracao('03/2024')).toBe(false)
    expect(isPeriodoApuracao('2024-13')).toBe(false)
    expect(isPeriodoApuracao(202403)).toBe(false)
  })

  it('resolve para o dia 1 do mês', () => {
    expect(periodoApuracaoStart('2024-03')).toBe('2024-03-01')
    expect(periodoApuracaoStart('02/2024')).toBe('2024-02-01')
  })

  it('formata como MM/AAAA', () => {
    expect(formatPeriodoApuracao('2024-03')).toBe('03/2024')
    expect(formatPeriodoApuracao('11/2006')).toBe('11/2006')
  })

  it('encontra o PA de uma data e desloca meses', () => {
    expect(periodoApuracaoOf('2024-02-29')).toBe('2024-02')
    expect(shiftPeriodoApuracao('2024-01', -1)).toBe('2023-12')
    expect(shiftPeriodoApuracao('2024-12', 1)).toBe('2025-01')
    expect(shiftPeriodoApuracao('2024-03', 0)).toBe('2024-03')
  })

  it('cobre o mês inteiro como intervalo [)', () => {
    expect(periodoApuracaoInterval('2024-02')).toEqual({ from: '2024-02-01', to: '2024-03-01' })
    expect(periodoApuracaoInterval('2023-12')).toEqual({ from: '2023-12-01', to: '2024-01-01' })
  })

  test.prop([anyIsoDateArb])('a data está no intervalo do seu próprio PA', (date) => {
    fc.pre(date < '9999-12-01')
    expect(containsDate(periodoApuracaoInterval(periodoApuracaoOf(date)), date)).toBe(true)
  })

  test.prop([fc.integer({ min: 1, max: 9999 }), fc.integer({ min: 1, max: 12 })])(
    'MM/AAAA e AAAA-MM são equivalentes',
    (year, month) => {
      const canonical = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
      expect(parsePeriodoApuracao(formatPeriodoApuracao(canonical))).toBe(canonical)
    },
  )
})

describe('data de referência', () => {
  it('expõe as origens canônicas', () => {
    expect(Object.values(ReferenceSource)).toEqual([
      'explicit',
      'periodo_apuracao',
      'question_text',
      'default',
      'clarified',
    ])
  })

  it('resolve a entrada do cliente', () => {
    expect(referenceDateFromInput({ periodoApuracao: '2024-03' })).toBe('2024-03-01')
    expect(referenceDateFromInput({ referenceDate: '2024-03-15' })).toBe('2024-03-15')
    expect(() => referenceDateFromInput({ referenceDate: '2024-02-30' })).toThrow(RangeError)
  })

  it('usa o mês anterior como default', () => {
    expect(defaultReferenceDate('2024-03-15')).toBe('2024-02-01')
    expect(defaultReferenceDate('2024-01-01')).toBe('2023-12-01')
  })

  test.prop([anyIsoDateArb])('o default é sempre um dia 1 anterior a hoje', (today) => {
    fc.pre(today >= '0001-02-01')
    const value = defaultReferenceDate(today)
    expect(value.endsWith('-01')).toBe(true)
    expect(toEpochDay(value)).toBeLessThan(toEpochDay(today))
  })

  it('detecta fronteira de vigência dentro do mês do PA', () => {
    const until15 = createInterval('2020-01-01', '2024-03-15')
    const from15 = createInterval('2024-03-15', null)
    const fromDay1 = createInterval('2024-03-01', null)
    const untilDay1 = createInterval(null, '2024-03-01')
    const fromApril = createInterval('2024-04-01', null)
    expect(hasBoundaryInsidePeriod('2024-03', [until15])).toBe(true)
    expect(hasBoundaryInsidePeriod('2024-03', [from15])).toBe(true)
    expect(hasBoundaryInsidePeriod('2024-03', [fromDay1, untilDay1, fromApril])).toBe(false)
    expect(hasBoundaryInsidePeriod('2024-03', [createInterval('2024-03-31', null)])).toBe(true)
    expect(hasBoundaryInsidePeriod('2024-03', [createInterval(null, null)])).toBe(false)
    expect(hasBoundaryInsidePeriod('2024-03', [])).toBe(false)
  })
})
