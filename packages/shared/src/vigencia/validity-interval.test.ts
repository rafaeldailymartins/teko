import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { intervalArb, intervalListArb, isoDateArb } from '../../test/arbitraries.ts'
import {
  compareIntervals,
  containsDate,
  containsInterval,
  createInterval,
  intersect,
  intervalsEqual,
  isAdjacent,
  isOpenEnded,
  lastIncludedDay,
  mergeIntervals,
  overlaps,
  singleDayInterval,
  type ValidityInterval,
} from './validity-interval.ts'

const y2020 = createInterval('2020-01-01', '2021-01-01')
const y2021 = createInterval('2021-01-01', '2022-01-01')
const from2021 = createInterval('2021-01-01', null)
const until2021 = createInterval(null, '2021-01-01')
const everything = createInterval(null, null)

describe('createInterval', () => {
  it('cria intervalos imutáveis', () => {
    expect(y2020).toEqual({ from: '2020-01-01', to: '2021-01-01' })
    expect(Object.isFrozen(y2020)).toBe(true)
  })

  it('rejeita intervalos vazios, invertidos ou com datas inválidas', () => {
    expect(() => createInterval('2020-01-01', '2020-01-01')).toThrow(RangeError)
    expect(() => createInterval('2021-01-01', '2020-01-01')).toThrow(RangeError)
    expect(() => createInterval('2020-02-30', null)).toThrow(/from/)
    expect(() => createInterval(null, '2020-13-01')).toThrow(/to/)
  })

  it('cria o intervalo de um único dia', () => {
    expect(singleDayInterval('2024-02-29')).toEqual({ from: '2024-02-29', to: '2024-03-01' })
  })
})

describe('containsDate', () => {
  it('inclui o limite inferior e exclui o superior', () => {
    expect(containsDate(y2020, '2020-01-01')).toBe(true)
    expect(containsDate(y2020, '2020-12-31')).toBe(true)
    expect(containsDate(y2020, '2021-01-01')).toBe(false)
    expect(containsDate(y2020, '2019-12-31')).toBe(false)
  })

  it('trata limites nulos como infinitos', () => {
    expect(containsDate(from2021, '9999-12-31')).toBe(true)
    expect(containsDate(from2021, '2020-12-31')).toBe(false)
    expect(containsDate(until2021, '0001-01-01')).toBe(true)
    expect(containsDate(until2021, '2021-01-01')).toBe(false)
    expect(containsDate(everything, '2024-06-15')).toBe(true)
  })

  it('identifica intervalos em vigor', () => {
    expect(isOpenEnded(from2021)).toBe(true)
    expect(isOpenEnded(y2020)).toBe(false)
  })
})

describe('overlaps, isAdjacent e intersect', () => {
  it('intervalos que só se tocam são adjacentes e não se sobrepõem', () => {
    expect(overlaps(y2020, y2021)).toBe(false)
    expect(isAdjacent(y2020, y2021)).toBe(true)
    expect(isAdjacent(y2021, y2020)).toBe(true)
    expect(intersect(y2020, y2021)).toBeNull()
  })

  it('intervalos abertos não são adjacentes por terem null nas pontas', () => {
    expect(isAdjacent(until2021, createInterval(null, '2022-01-01'))).toBe(false)
    expect(isAdjacent(from2021, createInterval('2023-01-01', null))).toBe(false)
  })

  it('calcula a interseção com limites abertos', () => {
    expect(intersect(until2021, createInterval('2020-06-01', null))).toEqual({
      from: '2020-06-01',
      to: '2021-01-01',
    })
    expect(intersect(everything, y2021)).toEqual(y2021)
    expect(intersect(y2021, everything)).toEqual(y2021)
    expect(intersect(everything, everything)).toEqual(everything)
    expect(overlaps(from2021, until2021)).toBe(false)
    expect(overlaps(everything, y2020)).toBe(true)
  })

  it('verifica contenção de intervalos', () => {
    expect(containsInterval(everything, y2020)).toBe(true)
    expect(containsInterval(from2021, y2021)).toBe(true)
    expect(containsInterval(y2021, from2021)).toBe(false)
    expect(containsInterval(y2020, until2021)).toBe(false)
    expect(containsInterval(until2021, y2020)).toBe(true)
    expect(containsInterval(y2020, y2021)).toBe(false)
  })

  test.prop([intervalArb, intervalArb])('overlaps é simétrica', (a, b) => {
    expect(overlaps(a, b)).toBe(overlaps(b, a))
  })

  test.prop([intervalArb, intervalArb])('isAdjacent é simétrica', (a, b) => {
    expect(isAdjacent(a, b)).toBe(isAdjacent(b, a))
  })

  test.prop([intervalArb, intervalArb])('intersect é comutativa', (a, b) => {
    expect(intersect(a, b)).toEqual(intersect(b, a))
  })

  test.prop([intervalArb, intervalArb, intervalArb])('intersect é associativa', (a, b, c) => {
    const ab = intersect(a, b)
    const bc = intersect(b, c)
    const left = ab === null ? null : intersect(ab, c)
    const right = bc === null ? null : intersect(a, bc)
    expect(left).toEqual(right)
  })

  test.prop([intervalArb])('intersect é idempotente', (a) => {
    expect(intersect(a, a)).toEqual(a)
  })

  test.prop([intervalArb, intervalArb])('overlaps equivale a interseção não vazia', (a, b) => {
    expect(overlaps(a, b)).toBe(intersect(a, b) !== null)
  })

  test.prop([intervalArb, intervalArb])('sobreposição e adjacência são exclusivas', (a, b) => {
    expect(overlaps(a, b) && isAdjacent(a, b)).toBe(false)
  })

  test.prop([intervalArb, intervalArb, isoDateArb])(
    'uma data está na interseção sse está nos dois intervalos',
    (a, b, date) => {
      const both = intersect(a, b)
      const inBoth = containsDate(a, date) && containsDate(b, date)
      expect(both !== null && containsDate(both, date)).toBe(inBoth)
    },
  )

  test.prop([intervalArb, intervalArb])('a interseção está contida nos dois intervalos', (a, b) => {
    const both = intersect(a, b)
    fc.pre(both !== null)
    if (both !== null) {
      expect(containsInterval(a, both)).toBe(true)
      expect(containsInterval(b, both)).toBe(true)
    }
  })
})

describe('compareIntervals', () => {
  it('ordena pelo limite inferior (null primeiro) e depois pelo superior (null por último)', () => {
    const list = [from2021, y2021, everything, y2020, until2021]
    expect([...list].sort(compareIntervals)).toEqual([
      until2021,
      everything,
      y2020,
      y2021,
      from2021,
    ])
  })

  it('devolve zero para intervalos iguais', () => {
    expect(compareIntervals(y2020, createInterval('2020-01-01', '2021-01-01'))).toBe(0)
    expect(compareIntervals(everything, createInterval(null, null))).toBe(0)
    expect(intervalsEqual(y2020, createInterval('2020-01-01', '2021-01-01'))).toBe(true)
    expect(intervalsEqual(y2020, y2021)).toBe(false)
  })

  test.prop([intervalArb, intervalArb])('é antissimétrica', (a, b) => {
    expect(compareIntervals(a, b)).toBe(-compareIntervals(b, a) || 0)
  })

  test.prop([intervalArb, intervalArb])('zero sse os intervalos são iguais', (a, b) => {
    expect(compareIntervals(a, b) === 0).toBe(intervalsEqual(a, b))
  })

  test.prop([intervalArb, intervalArb, intervalArb])('é transitiva', (a, b, c) => {
    fc.pre(compareIntervals(a, b) <= 0 && compareIntervals(b, c) <= 0)
    expect(compareIntervals(a, c)).toBeLessThanOrEqual(0)
  })
})

describe('mergeIntervals', () => {
  it('funde intervalos sobrepostos e adjacentes', () => {
    expect(
      mergeIntervals([
        y2021,
        createInterval('2023-01-01', '2024-01-01'),
        y2020,
        createInterval('2023-06-01', null),
      ]),
    ).toEqual([
      { from: '2020-01-01', to: '2022-01-01' },
      { from: '2023-01-01', to: null },
    ])
  })

  it('mantém a lista vazia e não altera a entrada', () => {
    const input: ValidityInterval[] = [y2021, y2020]
    expect(mergeIntervals([])).toEqual([])
    mergeIntervals(input)
    expect(input).toEqual([y2021, y2020])
  })

  test.prop([intervalListArb, isoDateArb])(
    'preserva o conjunto de datas cobertas',
    (list, date) => {
      const merged = mergeIntervals(list)
      expect(merged.some((i) => containsDate(i, date))).toBe(
        list.some((i) => containsDate(i, date)),
      )
    },
  )

  test.prop([intervalListArb])('produz lista ordenada, disjunta e sem adjacências', (list) => {
    const merged = mergeIntervals(list)
    for (let i = 1; i < merged.length; i += 1) {
      const previous = merged[i - 1]!
      const current = merged[i]!
      expect(compareIntervals(previous, current)).toBe(-1)
      expect(overlaps(previous, current)).toBe(false)
      expect(isAdjacent(previous, current)).toBe(false)
    }
  })

  test.prop([intervalListArb])('é idempotente', (list) => {
    const merged = mergeIntervals(list)
    expect(mergeIntervals(merged)).toEqual(merged)
  })
})

describe('lastIncludedDay', () => {
  it('é o dia anterior ao limite superior exclusivo', () => {
    expect(lastIncludedDay(y2020)).toBe('2020-12-31')
    expect(lastIncludedDay(createInterval('2024-02-01', '2024-03-01'))).toBe('2024-02-29')
  })

  it('é null para intervalos em vigor', () => {
    expect(lastIncludedDay(from2021)).toBeNull()
  })
})
