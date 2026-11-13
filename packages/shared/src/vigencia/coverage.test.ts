import { test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { intervalListArb, isoDateArb } from '../../test/arbitraries.ts'
import {
  effectiveCoverage,
  findCoveringInterval,
  isDateCovered,
  subtractIntervals,
} from './coverage.ts'
import { createInterval, isAdjacent, overlaps } from './validity-interval.ts'

const efd = [createInterval('2012-01-01', '2015-01-01'), createInterval('2016-01-01', null)]

describe('isDateCovered e findCoveringInterval', () => {
  it('encontra o intervalo que cobre a data', () => {
    expect(findCoveringInterval('2013-06-01', efd)).toEqual(efd[0])
    expect(findCoveringInterval('2030-01-01', efd)).toEqual(efd[1])
    expect(findCoveringInterval('2015-06-01', efd)).toBeUndefined()
  })

  it('respeita o limite superior exclusivo', () => {
    expect(isDateCovered('2014-12-31', efd)).toBe(true)
    expect(isDateCovered('2015-01-01', efd)).toBe(false)
    expect(isDateCovered('2011-12-31', efd)).toBe(false)
    expect(isDateCovered('2024-03-01', [])).toBe(false)
  })
})

describe('subtractIntervals', () => {
  it('abre buracos no meio, corta pontas e remove trechos inteiros', () => {
    const base = [createInterval('2020-01-01', '2021-01-01'), createInterval('2022-01-01', null)]
    const gaps = [
      createInterval('2020-03-01', '2020-04-01'),
      createInterval('2020-12-01', '2022-02-01'),
      createInterval('2023-01-01', null),
    ]
    expect(subtractIntervals(base, gaps)).toEqual([
      { from: '2020-01-01', to: '2020-03-01' },
      { from: '2020-04-01', to: '2020-12-01' },
      { from: '2022-02-01', to: '2023-01-01' },
    ])
  })

  it('lida com limites inferiores abertos', () => {
    expect(
      subtractIntervals([createInterval(null, '2021-01-01')], [createInterval(null, '2020-01-01')]),
    ).toEqual([{ from: '2020-01-01', to: '2021-01-01' }])
    expect(
      subtractIntervals([createInterval(null, null)], [createInterval('2020-01-01', '2021-01-01')]),
    ).toEqual([
      { from: null, to: '2020-01-01' },
      { from: '2021-01-01', to: null },
    ])
  })

  it('não altera o que não se sobrepõe', () => {
    const base = [createInterval('2020-01-01', '2021-01-01')]
    expect(subtractIntervals(base, [createInterval('2021-01-01', null)])).toEqual(base)
    expect(subtractIntervals(base, [])).toEqual(base)
  })

  test.prop([intervalListArb, intervalListArb, isoDateArb])(
    'uma data sobra sse está na base e em nenhum buraco',
    (base, gaps, date) => {
      const expected = isDateCovered(date, base) && !isDateCovered(date, gaps)
      expect(isDateCovered(date, subtractIntervals(base, gaps))).toBe(expected)
    },
  )

  test.prop([intervalListArb, intervalListArb])('o resultado é canônico', (base, gaps) => {
    const result = subtractIntervals(base, gaps)
    result.slice(1).forEach((current, index) => {
      const previous = result[index]!
      expect(overlaps(previous, current) || isAdjacent(previous, current)).toBe(false)
    })
  })
})

describe('effectiveCoverage', () => {
  it('limita a cobertura ao verified_at (inclusive)', () => {
    expect(effectiveCoverage(efd, '2024-03-10')).toEqual([
      { from: '2012-01-01', to: '2015-01-01' },
      { from: '2016-01-01', to: '2024-03-11' },
    ])
  })

  it('descarta intervalos inteiramente posteriores ao verified_at e aplica os buracos', () => {
    expect(
      effectiveCoverage(efd, '2014-06-30', [createInterval('2013-01-01', '2014-01-01')]),
    ).toEqual([
      { from: '2012-01-01', to: '2013-01-01' },
      { from: '2014-01-01', to: '2014-07-01' },
    ])
  })

  test.prop([intervalListArb, isoDateArb, isoDateArb])(
    'nenhuma data posterior ao verified_at é coberta',
    (covered, verifiedAt, date) => {
      const effective = effectiveCoverage(covered, verifiedAt)
      const expected = date <= verifiedAt && isDateCovered(date, covered)
      expect(isDateCovered(date, effective)).toBe(expected)
    },
  )
})
