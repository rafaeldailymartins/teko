import { fromCalendarDate, type IsoDate } from '@teko/shared/vigencia'

/**
 * Datas citadas no texto da pergunta (`extractDateMentions`), usadas pelo `ResolveReferenceDate`
 * como segunda fonte de precedência. Só formas com ano de 4 dígitos (1900–2099) entram: anos de 2
 * dígitos, números de artigo, valores monetários e códigos de registro ficam de fora.
 *
 * - dia: `05/03/2024`, `5.3.2024`, `05-03-2024`, `2024-03-05`, `5 de março de 2024`;
 * - mês (período de apuração, resolve para o dia 1): `03/2024`, `03-2024`, `2024-03`,
 *   `março de 2024`, `março/2024`, `mar/2024`, `March 2024`.
 */

export const DateGranularity = {
  Day: 'day',
  Month: 'month',
} as const
export type DateGranularity = (typeof DateGranularity)[keyof typeof DateGranularity]

export interface DateMention {
  /** A data citada; um mês resolve para o dia 1. */
  readonly value: IsoDate
  readonly granularity: DateGranularity
  /** Trecho do texto que gerou a menção. */
  readonly raw: string
}

const MONTHS: ReadonlyMap<string, number> = new Map([
  ['janeiro', 1],
  ['jan', 1],
  ['january', 1],
  ['fevereiro', 2],
  ['fev', 2],
  ['february', 2],
  ['feb', 2],
  ['marco', 3],
  ['mar', 3],
  ['march', 3],
  ['abril', 4],
  ['abr', 4],
  ['april', 4],
  ['apr', 4],
  ['maio', 5],
  ['mai', 5],
  ['may', 5],
  ['junho', 6],
  ['jun', 6],
  ['june', 6],
  ['julho', 7],
  ['jul', 7],
  ['july', 7],
  ['agosto', 8],
  ['ago', 8],
  ['august', 8],
  ['aug', 8],
  ['setembro', 9],
  ['set', 9],
  ['september', 9],
  ['sep', 9],
  ['sept', 9],
  ['outubro', 10],
  ['out', 10],
  ['october', 10],
  ['oct', 10],
  ['novembro', 11],
  ['nov', 11],
  ['november', 11],
  ['dezembro', 12],
  ['dez', 12],
  ['december', 12],
  ['dec', 12],
])

const YEAR = '((?:19|20)\\d{2})'
const MONTH_NAME = '([a-z]{3,9})\\.?'

/** Ordem importa: formas de dia antes das de mês, e cada trecho do texto é consumido uma vez. */
const PATTERNS: readonly {
  readonly regex: RegExp
  readonly build: (m: RegExpExecArray) => Candidate
}[] = [
  {
    // 2024-03-05
    regex: new RegExp(`(?<![\\d./-])${YEAR}-(\\d{2})-(\\d{2})(?![\\d./-])`, 'g'),
    build: (m) => ({ year: m[1], month: m[2], day: m[3] }),
  },
  {
    // 05/03/2024, 5.3.2024, 05-03-2024
    regex: new RegExp(`(?<![\\d./-])(\\d{1,2})([./-])(\\d{1,2})\\2${YEAR}(?![\\d./-])`, 'g'),
    build: (m) => ({ year: m[4], month: m[3], day: m[1] }),
  },
  {
    // 5 de março de 2024, 1º de julho de 2026
    regex: new RegExp(
      `(?<![\\d])(\\d{1,2})(?:º|°|o)?\\s+de\\s+${MONTH_NAME}\\s+de\\s+${YEAR}(?!\\d)`,
      'g',
    ),
    build: (m) => ({ year: m[3], monthName: m[2], day: m[1] }),
  },
  {
    // 2024-03
    regex: new RegExp(`(?<![\\d./-])${YEAR}-(\\d{2})(?![\\d./-])`, 'g'),
    build: (m) => ({ year: m[1], month: m[2] }),
  },
  {
    // 03/2024, 3-2024
    regex: new RegExp(`(?<![\\d./-])(\\d{1,2})[/-]${YEAR}(?![\\d./-])`, 'g'),
    build: (m) => ({ year: m[2], month: m[1] }),
  },
  {
    // março de 2024, março/2024, mar/2024, março 2024, March 2024, March, 2024
    regex: new RegExp(`(?<![a-z])${MONTH_NAME}(?:\\s+de\\s+|\\s*/\\s*|,?\\s+)${YEAR}(?!\\d)`, 'g'),
    build: (m) => ({ year: m[2], monthName: m[1] }),
  },
]

interface Candidate {
  readonly year: string | undefined
  readonly month?: string | undefined
  readonly monthName?: string | undefined
  readonly day?: string | undefined
}

/** Minúsculas e sem acentos, preservando o comprimento (as posições valem no texto original). */
function foldForMatching(text: string): string {
  return Array.from(text, (char) => {
    const folded = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    return folded.length === char.length ? folded : char.toLowerCase()
  }).join('')
}

function toMention(candidate: Candidate, raw: string): DateMention | undefined {
  const year = Number(candidate.year)
  const month =
    candidate.monthName === undefined ? Number(candidate.month) : MONTHS.get(candidate.monthName)
  if (month === undefined) {
    return undefined
  }
  const day = candidate.day === undefined ? 1 : Number(candidate.day)
  try {
    return Object.freeze({
      value: fromCalendarDate({ year, month, day }),
      granularity: candidate.day === undefined ? DateGranularity.Month : DateGranularity.Day,
      raw,
    })
  } catch {
    return undefined
  }
}

/**
 * Menções de data na ordem em que aparecem, sem repetir a mesma data com a mesma granularidade.
 * Um trecho reconhecido por uma forma não é reaproveitado pelas seguintes.
 */
export function extractDateMentions(text: string): DateMention[] {
  const folded = foldForMatching(text)
  const taken: boolean[] = new Array<boolean>(folded.length).fill(false)
  const found: { readonly index: number; readonly mention: DateMention }[] = []
  for (const { regex, build } of PATTERNS) {
    for (const match of folded.matchAll(regex)) {
      const start = match.index
      const end = start + match[0].length
      if (taken.slice(start, end).some(Boolean)) {
        continue
      }
      const mention = toMention(build(match), text.slice(start, end))
      if (mention === undefined) {
        continue
      }
      taken.fill(true, start, end)
      found.push({ index: start, mention })
    }
  }
  found.sort((a, b) => a.index - b.index)
  const seen = new Set<string>()
  const mentions: DateMention[] = []
  for (const { mention } of found) {
    const key = `${mention.granularity}:${mention.value}`
    if (!seen.has(key)) {
      seen.add(key)
      mentions.push(mention)
    }
  }
  return mentions
}
