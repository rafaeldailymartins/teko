import { describe, expect, it } from 'vitest'
import { DateGranularity, extractDateMentions } from './date-mentions.ts'

const month = DateGranularity.Month
const day = DateGranularity.Day

describe('extractDateMentions', () => {
  it.each([
    ['em 05/2006', '2006-05-01', month, '05/2006'],
    ['em 3-2024', '2024-03-01', month, '3-2024'],
    ['no PA 2024-03', '2024-03-01', month, '2024-03'],
    ['em maio de 2006', '2006-05-01', month, 'maio de 2006'],
    ['março/2024', '2024-03-01', month, 'março/2024'],
    ['marco de 2020', '2020-03-01', month, 'marco de 2020'],
    ['mar/2024', '2024-03-01', month, 'mar/2024'],
    ['jun. 2025', '2025-06-01', month, 'jun. 2025'],
    ['March 2024', '2024-03-01', month, 'March 2024'],
    ['September, 2023', '2023-09-01', month, 'September, 2023'],
    ['dia 15/03/2024', '2024-03-15', day, '15/03/2024'],
    ['5.3.2024', '2024-03-05', day, '5.3.2024'],
    ['05-03-2024', '2024-03-05', day, '05-03-2024'],
    ['em 2024-03-15', '2024-03-15', day, '2024-03-15'],
    ['5 de março de 2024', '2024-03-05', day, '5 de março de 2024'],
    ['1º de julho de 2026', '2026-07-01', day, '1º de julho de 2026'],
  ])('%s', (text, value, granularity, raw) => {
    expect(extractDateMentions(text)).toEqual([{ value, granularity, raw }])
  })

  it.each([
    'art. 76, § 6º',
    'R$ 300.000,00',
    'registro C170',
    'em 2006',
    'em 1899',
    '31/02/2024',
    '13/2024',
    '2024-13',
    'foo de 2024',
    '12/05/24',
  ])('não é data: %s', (text) => {
    expect(extractDateMentions(text)).toEqual([])
  })

  it.each([
    ['janeiro', 'jan', 'january', null, 1],
    ['fevereiro', 'fev', 'february', 'feb', 2],
    ['março', 'mar', 'march', null, 3],
    ['abril', 'abr', 'april', 'apr', 4],
    ['maio', 'mai', 'may', null, 5],
    ['junho', 'jun', 'june', null, 6],
    ['julho', 'jul', 'july', null, 7],
    ['agosto', 'ago', 'august', 'aug', 8],
    ['setembro', 'set', 'september', 'sep', 9],
    ['outubro', 'out', 'october', 'oct', 10],
    ['novembro', 'nov', 'november', 'nov', 11],
    ['dezembro', 'dez', 'december', 'dec', 12],
  ])('mês %s e abreviações', (pt, short, en, enShort, month) => {
    const value = `2024-${String(month).padStart(2, '0')}-01`
    for (const name of [pt, short, en, enShort]) {
      if (name !== null) {
        expect(extractDateMentions(`${name}/2024`).map((mention) => mention.value)).toEqual([value])
      }
    }
    expect(extractDateMentions('sept 2024').map((mention) => mention.value)).toEqual(['2024-09-01'])
  })

  it('devolve na ordem do texto, sem repetir a mesma data e granularidade', () => {
    expect(
      extractDateMentions('de 15/02/2006 até fevereiro de 2006, e de novo 15.02.2006 e 05/2006'),
    ).toEqual([
      { value: '2006-02-15', granularity: day, raw: '15/02/2006' },
      { value: '2006-02-01', granularity: month, raw: 'fevereiro de 2006' },
      { value: '2006-05-01', granularity: month, raw: '05/2006' },
    ])
  })

  it('um trecho já reconhecido como dia não vira também mês', () => {
    expect(extractDateMentions('15/03/2024')).toHaveLength(1)
    expect(extractDateMentions('2024-03-15')).toHaveLength(1)
  })
})
