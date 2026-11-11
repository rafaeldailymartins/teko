import { test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { intervalArb, intervalListArb } from '../../test/arbitraries.ts'
import {
  fromPostgresMultirange,
  fromPostgresRange,
  toPostgresMultirange,
  toPostgresRange,
} from './postgres-range.ts'
import { createInterval, mergeIntervals } from './validity-interval.ts'

describe('toPostgresRange', () => {
  it('produz a forma canônica [) do Postgres', () => {
    expect(toPostgresRange(createInterval('2020-01-01', '2021-01-01'))).toBe(
      '[2020-01-01,2021-01-01)',
    )
    expect(toPostgresRange(createInterval('2020-01-01', null))).toBe('[2020-01-01,)')
    expect(toPostgresRange(createInterval(null, '2021-01-01'))).toBe('(,2021-01-01)')
    expect(toPostgresRange(createInterval(null, null))).toBe('(,)')
  })
})

describe('fromPostgresRange', () => {
  it('lê a saída canônica do Postgres', () => {
    expect(fromPostgresRange('[2020-01-01,2021-01-01)')).toEqual({
      from: '2020-01-01',
      to: '2021-01-01',
    })
    expect(fromPostgresRange('[2020-01-01,)')).toEqual({ from: '2020-01-01', to: null })
    expect(fromPostgresRange('(,2021-01-01)')).toEqual({ from: null, to: '2021-01-01' })
    expect(fromPostgresRange('(,)')).toEqual({ from: null, to: null })
  })

  it('trata infinity e -infinity como limites abertos', () => {
    expect(fromPostgresRange('[2020-01-01,infinity)')).toEqual({ from: '2020-01-01', to: null })
    expect(fromPostgresRange('[-infinity,2021-01-01)')).toEqual({ from: null, to: '2021-01-01' })
    expect(fromPostgresRange('[-INFINITY,Infinity)')).toEqual({ from: null, to: null })
  })

  it('aceita aspas e espaços', () => {
    expect(fromPostgresRange(' ["2020-01-01", "2021-01-01") ')).toEqual({
      from: '2020-01-01',
      to: '2021-01-01',
    })
  })

  it('normaliza limites não canônicos para [)', () => {
    expect(fromPostgresRange('(2020-01-01,2020-12-31]')).toEqual({
      from: '2020-01-02',
      to: '2021-01-01',
    })
    expect(fromPostgresRange('[2020-01-01,2020-12-31]')).toEqual({
      from: '2020-01-01',
      to: '2021-01-01',
    })
  })

  it('devolve null para o range vazio', () => {
    expect(fromPostgresRange('empty')).toBeNull()
    expect(fromPostgresRange(' EMPTY ')).toBeNull()
    expect(fromPostgresRange('[2020-01-01,2020-01-01)')).toBeNull()
    expect(fromPostgresRange('(2020-01-01,2020-01-02)')).toBeNull()
    expect(fromPostgresRange('(2020-01-01,2020-01-01]')).toBeNull()
    expect(fromPostgresRange('(2020-01-01,2020-01-01)')).toBeNull()
  })

  it('limites iguais e inclusivos são um dia, como no Postgres', () => {
    expect(fromPostgresRange('[2020-01-01,2020-01-01]')).toEqual({
      from: '2020-01-01',
      to: '2020-01-02',
    })
  })

  // O Postgres rejeita limites invertidos antes de canonizar ("range lower bound must be less
  // than or equal to range upper bound"); só limites iguais e não ambos inclusivos viram `empty`.
  it.each([
    '[2021-01-01,2020-01-01)',
    '(2020-01-05,2020-01-01]',
    '[2020-01-02,2020-01-01]',
    '(2020-01-02,2020-01-01)',
  ])('rejeita limites invertidos %j', (text) => {
    expect(() => fromPostgresRange(text)).toThrow(RangeError)
    expect(() => fromPostgresRange(text)).toThrow(/limite inferior maior que o superior/)
  })

  it.each([
    '',
    '2020-01-01,2021-01-01',
    '[2020-01-01;2021-01-01)',
    '[2020-02-30,2021-01-01)',
    '[2020-01-01,2021-13-01)',
    '[infinity,2021-01-01)',
    '[2020-01-01,-infinity)',
    '["2020-01-01,2021-01-01)',
  ])('rejeita a sintaxe inválida %j', (text) => {
    expect(() => fromPostgresRange(text)).toThrow(RangeError)
  })

  test.prop([intervalArb])('ida e volta preserva o intervalo', (interval) => {
    expect(fromPostgresRange(toPostgresRange(interval))).toEqual(interval)
  })
})

describe('datemultirange', () => {
  it('serializa a lista canonizada', () => {
    expect(
      toPostgresMultirange([
        createInterval('2022-01-01', null),
        createInterval('2020-01-01', '2021-01-01'),
        createInterval('2021-01-01', '2021-06-01'),
      ]),
    ).toBe('{[2020-01-01,2021-06-01),[2022-01-01,)}')
    expect(toPostgresMultirange([])).toBe('{}')
  })

  it('lê a saída do Postgres', () => {
    expect(fromPostgresMultirange('{[2012-01-01,2020-01-01),[2021-01-01,)}')).toEqual([
      { from: '2012-01-01', to: '2020-01-01' },
      { from: '2021-01-01', to: null },
    ])
    expect(fromPostgresMultirange('{}')).toEqual([])
    expect(fromPostgresMultirange(' { } ')).toEqual([])
    expect(fromPostgresMultirange('{empty}')).toEqual([])
  })

  it('canoniza a entrada e descarta ranges vazios', () => {
    expect(
      fromPostgresMultirange('{[2021-01-01,2022-01-01), [2020-01-01,2020-12-31], empty}'),
    ).toEqual([{ from: '2020-01-01', to: '2022-01-01' }])
  })

  it.each([
    '[2020-01-01,2021-01-01)',
    '{,}',
    '{R}',
    '{[2020-01-01,2021-01-01),}',
    '{[2020-01-01,2021-01-01) [2022-01-01,)}',
    '{[2020-01-01,2021-01-01) x}',
    '{[2020-01-01;2021-01-01)}',
    '{[2021-01-01,2020-01-01)}',
  ])('rejeita %j', (text) => {
    expect(() => fromPostgresMultirange(text)).toThrow(RangeError)
  })

  test.prop([intervalListArb])('ida e volta devolve a forma canônica', (list) => {
    expect(fromPostgresMultirange(toPostgresMultirange(list))).toEqual(mergeIntervals(list))
  })
})
