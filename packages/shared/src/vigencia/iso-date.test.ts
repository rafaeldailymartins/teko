import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { anyIsoDateArb } from '../../test/arbitraries.ts'
import {
  addDays,
  addMonthsToMonthStart,
  compareIsoDates,
  daysInMonth,
  fromCalendarDate,
  fromEpochDay,
  isIsoDate,
  isLeapYear,
  isoDateInTimeZone,
  parseIsoDate,
  startOfMonth,
  toCalendarDate,
  toEpochDay,
} from './iso-date.ts'

describe('isIsoDate', () => {
  it.each(['2024-02-29', '2000-02-29', '2023-12-31', '0001-01-01', '9999-12-31', '2024-04-30'])(
    'aceita a data real %s',
    (value) => {
      expect(isIsoDate(value)).toBe(true)
    },
  )

  it.each([
    '2023-02-29',
    '1900-02-29',
    '2024-04-31',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '0000-01-01',
    '2024-1-01',
    '24-01-01',
    '2024-01-01T00:00:00Z',
    ' 2024-01-01',
    '2024/01/01',
    '',
  ])('rejeita %j', (value) => {
    expect(isIsoDate(value)).toBe(false)
  })

  it('rejeita valores que não são string', () => {
    expect(isIsoDate(20240101)).toBe(false)
    expect(isIsoDate(null)).toBe(false)
    expect(isIsoDate(new Date())).toBe(false)
  })
})

describe('calendário', () => {
  it('segue as regras gregorianas de ano bissexto', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(2023)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })

  it('conhece o tamanho de cada mês', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => daysInMonth(2023, m))).toEqual([
      31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
    ])
    expect(daysInMonth(2024, 2)).toBe(29)
  })
})

describe('parseIsoDate e conversões', () => {
  it('devolve a própria string quando válida', () => {
    expect(parseIsoDate('2024-03-01')).toBe('2024-03-01')
  })

  it('lança RangeError para datas inexistentes', () => {
    expect(() => parseIsoDate('2023-02-29')).toThrow(RangeError)
    expect(() => toCalendarDate('2023-02-29')).toThrow(RangeError)
    expect(() => toCalendarDate('abc')).toThrow(RangeError)
  })

  it('decompõe e recompõe datas', () => {
    expect(toCalendarDate('2024-03-07')).toEqual({ year: 2024, month: 3, day: 7 })
    expect(fromCalendarDate({ year: 7, month: 1, day: 2 })).toBe('0007-01-02')
    expect(() => fromCalendarDate({ year: 2024, month: 2, day: 30 })).toThrow(RangeError)
    expect(() => fromCalendarDate({ year: 10_000, month: 1, day: 1 })).toThrow(RangeError)
    expect(() => fromCalendarDate({ year: 2024.5, month: 1, day: 1 })).toThrow(RangeError)
  })

  it('usa dias de época a partir de 1970-01-01', () => {
    expect(toEpochDay('1970-01-01')).toBe(0)
    expect(toEpochDay('1970-01-02')).toBe(1)
    expect(toEpochDay('1969-12-31')).toBe(-1)
    expect(fromEpochDay(19_783)).toBe('2024-03-01')
    expect(toEpochDay('0050-06-15')).toBeLessThan(toEpochDay('1950-06-15'))
  })

  it('rejeita dias de época não inteiros ou fora da faixa', () => {
    expect(() => fromEpochDay(1.5)).toThrow(RangeError)
    expect(() => fromEpochDay(Number.NaN)).toThrow(RangeError)
    expect(() => fromEpochDay(toEpochDay('9999-12-31') + 1)).toThrow(RangeError)
  })

  test.prop([anyIsoDateArb])('toEpochDay e fromEpochDay são inversas', (date) => {
    expect(fromEpochDay(toEpochDay(date))).toBe(date)
  })

  test.prop([anyIsoDateArb, anyIsoDateArb])('a ordem das strings é a ordem cronológica', (a, b) => {
    expect(compareIsoDates(a, b)).toBe(Math.sign(toEpochDay(a) - toEpochDay(b)))
  })
})

describe('aritmética', () => {
  it('soma dias atravessando meses e anos bissextos', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01')
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01')
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31')
    expect(addDays('2024-03-10', 0)).toBe('2024-03-10')
  })

  it('compara datas', () => {
    expect(compareIsoDates('2024-01-01', '2024-01-02')).toBe(-1)
    expect(compareIsoDates('2024-01-02', '2024-01-01')).toBe(1)
    expect(compareIsoDates('2024-01-01', '2024-01-01')).toBe(0)
  })

  it('calcula inícios de mês', () => {
    expect(startOfMonth('2024-03-17')).toBe('2024-03-01')
    expect(addMonthsToMonthStart('2024-01-31', 1)).toBe('2024-02-01')
    expect(addMonthsToMonthStart('2024-01-15', -1)).toBe('2023-12-01')
    expect(addMonthsToMonthStart('2024-12-01', 1)).toBe('2025-01-01')
    expect(addMonthsToMonthStart('2024-03-01', -27)).toBe('2021-12-01')
  })

  test.prop([anyIsoDateArb, fc.integer({ min: -400, max: 400 })])(
    'addDays desloca exatamente n dias',
    (date, days) => {
      fc.pre(toEpochDay(date) + days >= toEpochDay('0001-01-01'))
      fc.pre(toEpochDay(date) + days <= toEpochDay('9999-12-31'))
      expect(toEpochDay(addDays(date, days))).toBe(toEpochDay(date) + days)
    },
  )
})

describe('isoDateInTimeZone', () => {
  it('calcula "hoje" em São Paulo por padrão', () => {
    // 02:30 UTC de 1º de março ainda é 29 de fevereiro em São Paulo (UTC-3).
    expect(isoDateInTimeZone(new Date('2024-03-01T02:30:00Z'))).toBe('2024-02-29')
    expect(isoDateInTimeZone(new Date('2024-03-01T03:00:00Z'))).toBe('2024-03-01')
  })

  it('aceita outro fuso IANA', () => {
    expect(isoDateInTimeZone(new Date('2024-03-01T02:30:00Z'), 'UTC')).toBe('2024-03-01')
  })

  it('lança para instante inválido', () => {
    expect(() => isoDateInTimeZone(new Date(Number.NaN))).toThrow(RangeError)
  })
})
