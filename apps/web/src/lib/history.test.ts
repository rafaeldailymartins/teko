import { describe, expect, it } from 'vitest'
import { filterByTitle, groupHistory, HistoryGroup, historyGroupOf } from './history.ts'

const TODAY = '2026-11-16'

describe('historyGroupOf', () => {
  it('usa o dia de São Paulo: 01:00 UTC de hoje ainda é ontem lá', () => {
    expect(historyGroupOf('2026-11-16T12:00:00.000Z', TODAY)).toBe(HistoryGroup.Today)
    expect(historyGroupOf('2026-11-16T01:00:00.000Z', TODAY)).toBe(HistoryGroup.Yesterday)
    expect(historyGroupOf('2026-11-12T12:00:00.000Z', TODAY)).toBe(HistoryGroup.Week)
    expect(historyGroupOf('2026-10-20T12:00:00.000Z', TODAY)).toBe(HistoryGroup.Month)
    expect(historyGroupOf('2026-09-01T12:00:00.000Z', TODAY)).toBe(HistoryGroup.Older)
  })
})

describe('groupHistory', () => {
  it('mantém a ordem dos itens e dos grupos e não devolve grupo vazio', () => {
    const items = [
      { id: 'a', updatedAt: '2026-11-16T15:00:00.000Z' },
      { id: 'b', updatedAt: '2026-11-16T13:00:00.000Z' },
      { id: 'c', updatedAt: '2026-09-01T12:00:00.000Z' },
    ]
    expect(groupHistory(items, TODAY)).toEqual([
      { group: 'today', items: [items[0], items[1]] },
      { group: 'older', items: [items[2]] },
    ])
    expect(groupHistory([], TODAY)).toEqual([])
  })
})

describe('filterByTitle', () => {
  const items = [{ title: 'Crédito de ICMS na EFD' }, { title: 'RCTE art. 76, § 6º' }]

  it('ignora acento e caixa, e exige todas as palavras', () => {
    expect(filterByTitle(items, 'credito efd')).toEqual([items[0]])
    expect(filterByTitle(items, 'RCTE 76')).toEqual([items[1]])
    expect(filterByTitle(items, 'icms reinf')).toEqual([])
    expect(filterByTitle(items, '  ')).toBe(items)
  })
})
