import { addDays, type IsoDate, isIsoDate } from './iso-date.ts'
import { isNonEmptyInterval, mergeIntervals, type ValidityInterval } from './validity-interval.ts'

/**
 * Conversão entre `ValidityInterval` e a representação textual de `daterange` e
 * `datemultirange` do Postgres.
 *
 * A saída é sempre a forma canônica que o próprio Postgres produz para tipos discretos
 * (`[a,b)`, com `(` só para limite inferior aberto). A entrada aceita qualquer combinação de
 * colchetes e parênteses, valores entre aspas e `infinity`/`-infinity`, e normaliza para `[)`.
 */

const RANGE_PATTERN = /^\s*([[(])\s*("?)([^,"()[\]]*)\2\s*,\s*("?)([^,"()[\]]*)\4\s*([\])])\s*$/
const RANGE_IN_MULTIRANGE = /[[(][^\])]*[\])]/g
const EMPTY_ELEMENT = /\bempty\b/gi
const MULTIRANGE_SKELETON = /^(?:R(?:,R)*)?$/

/** `"[2020-01-01,2021-01-01)"`, `"[2020-01-01,)"`, `"(,2021-01-01)"` ou `"(,)"`. */
export function toPostgresRange(interval: ValidityInterval): string {
  const lower = interval.from === null ? '(' : `[${interval.from}`
  return `${lower},${interval.to ?? ''})`
}

function parseBound(raw: string, side: 'lower' | 'upper', text: string): IsoDate | null {
  const value = raw.trim()
  const unbounded = side === 'lower' ? '-infinity' : 'infinity'
  if (value === '' || value.toLowerCase() === unbounded) {
    return null
  }
  if (!isIsoDate(value)) {
    throw new RangeError(`Limite de daterange inválido em ${JSON.stringify(text)}`)
  }
  return value
}

/**
 * Lê um `daterange` textual. Devolve `null` para o range vazio (`empty`, ou limites iguais que se
 * anulam depois da normalização, como `[2020-01-01,2020-01-01)`). Lança `RangeError` se a
 * sintaxe for inválida ou se o limite inferior for maior que o superior: como no Postgres, a
 * inversão é erro (comparada nos valores brutos, antes da normalização) e não range vazio.
 */
export function fromPostgresRange(text: string): ValidityInterval | null {
  if (text.trim().toLowerCase() === 'empty') {
    return null
  }
  const match = RANGE_PATTERN.exec(text)
  if (match === null) {
    throw new RangeError(`daterange inválido: ${JSON.stringify(text)}`)
  }
  const [, lowerBracket, , lowerRaw = '', , upperRaw = '', upperBracket] = match
  let from = parseBound(lowerRaw, 'lower', text)
  let to = parseBound(upperRaw, 'upper', text)
  if (from !== null && to !== null && from > to) {
    throw new RangeError(
      `daterange com limite inferior maior que o superior: ${JSON.stringify(text)}`,
    )
  }
  // Canonização para [): limite inferior exclusivo avança um dia; superior inclusivo também.
  if (from !== null && lowerBracket === '(') {
    from = addDays(from, 1)
  }
  if (to !== null && upperBracket === ']') {
    to = addDays(to, 1)
  }
  return isNonEmptyInterval(from, to) ? Object.freeze({ from, to }) : null
}

/** `"{[2020-01-01,2021-01-01),[2022-01-01,)}"`; a lista é canonizada antes (ordenada e fundida). */
export function toPostgresMultirange(intervals: readonly ValidityInterval[]): string {
  return `{${mergeIntervals(intervals).map(toPostgresRange).join(',')}}`
}

/** Lê um `datemultirange` textual e devolve a lista canônica (ordenada, disjunta, sem vazios). */
export function fromPostgresMultirange(text: string): ValidityInterval[] {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    throw new RangeError(`datemultirange inválido: ${JSON.stringify(text)}`)
  }
  const body = trimmed.slice(1, -1)
  const ranges = body.match(RANGE_IN_MULTIRANGE) ?? []
  // Cada elemento (range ou `empty`) vira "R": o que sobra tem de ser uma lista "R,R,...".
  const skeleton = body
    .replace(RANGE_IN_MULTIRANGE, 'R')
    .replace(EMPTY_ELEMENT, 'R')
    .replaceAll(/\s/g, '')
  const elements = ranges.length + (body.match(EMPTY_ELEMENT) ?? []).length
  if (!MULTIRANGE_SKELETON.test(skeleton) || skeleton.replaceAll(',', '').length !== elements) {
    throw new RangeError(`datemultirange inválido: ${JSON.stringify(text)}`)
  }
  const intervals = ranges
    .map((range) => fromPostgresRange(range))
    .filter((interval): interval is ValidityInterval => interval !== null)
  return mergeIntervals(intervals)
}
