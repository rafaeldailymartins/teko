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

/**
 * Tetos de tamanho da entrada. Um `daterange` canônico tem no máximo 23 caracteres e um
 * `datemultirange` real fica muito abaixo de 64 KiB; texto maior que isso não é um valor do banco,
 * e recusá-lo de cara limita o custo de qualquer entrada não confiável.
 */
const MAX_RANGE_LENGTH = 256
const MAX_MULTIRANGE_LENGTH = 64 * 1024

/**
 * Caracteres que nunca fazem parte de um valor de limite: delimitadores de range e aspas soltas.
 * A vírgula fica de fora porque o separador já é tratado antes (um único por range).
 */
const FORBIDDEN_IN_BOUND = /["()[\]]/

/** Delimitadores estruturais de um multirange; um caractere por vez, busca linear. */
const MULTIRANGE_DELIMITERS = /[[\](),]/g

const LOWER_BRACKETS = new Set(['[', '('])
const UPPER_BRACKETS = new Set([']', ')'])

function invalidRange(text: string): RangeError {
  return new RangeError(`daterange inválido: ${JSON.stringify(text)}`)
}

function invalidMultirange(text: string): RangeError {
  return new RangeError(`datemultirange inválido: ${JSON.stringify(text)}`)
}

function assertMaxLength(text: string, max: number, kind: string): void {
  if (text.length > max) {
    throw new RangeError(`${kind} longo demais: ${text.length} caracteres (máximo ${max})`)
  }
}

/** `"[2020-01-01,2021-01-01)"`, `"[2020-01-01,)"`, `"(,2021-01-01)"` ou `"(,)"`. */
export function toPostgresRange(interval: ValidityInterval): string {
  const lower = interval.from === null ? '(' : `[${interval.from}`
  return `${lower},${interval.to ?? ''})`
}

/**
 * Tira as aspas opcionais de um limite (`"2020-01-01"` ou `2020-01-01`, com espaços em volta).
 * Aspas desbalanceadas ou delimitadores dentro do valor são sintaxe inválida.
 */
function unquoteBound(raw: string, text: string): string {
  const trimmed = raw.trim()
  const quoted = trimmed.startsWith('"')
  if (quoted && (trimmed.length < 2 || !trimmed.endsWith('"'))) {
    throw invalidRange(text)
  }
  const value = quoted ? trimmed.slice(1, -1) : trimmed
  if (FORBIDDEN_IN_BOUND.test(value)) {
    throw invalidRange(text)
  }
  return value
}

function parseBound(raw: string, side: 'lower' | 'upper', text: string): IsoDate | null {
  const value = unquoteBound(raw, text).trim()
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
  assertMaxLength(text, MAX_RANGE_LENGTH, 'daterange')
  const trimmed = text.trim()
  if (trimmed.toLowerCase() === 'empty') {
    return null
  }
  // Leitura linear, sem regex: colchete, limite, uma única vírgula, limite, colchete.
  const lowerBracket = trimmed.charAt(0)
  const upperBracket = trimmed.charAt(trimmed.length - 1)
  const inner = trimmed.slice(1, -1)
  const comma = inner.indexOf(',')
  const lowerRaw = inner.slice(0, comma)
  const upperRaw = inner.slice(comma + 1)
  if (
    !LOWER_BRACKETS.has(lowerBracket) ||
    !UPPER_BRACKETS.has(upperBracket) ||
    comma === -1 ||
    upperRaw.includes(',')
  ) {
    throw invalidRange(text)
  }
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
  assertMaxLength(text, MAX_MULTIRANGE_LENGTH, 'datemultirange')
  const trimmed = text.trim()
  // Um texto de um só caractere não começa com `{` e termina com `}` ao mesmo tempo.
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    throw invalidMultirange(text)
  }
  const body = trimmed.slice(1, -1)
  if (body.trim() === '') {
    return []
  }
  // Uma única passada pelos delimitadores: cada vírgula fora de um range fecha um elemento, que é
  // lido na hora (a primeira falha interrompe a leitura). Colchete aberto dentro de range, fechado
  // fora dele ou range sem fechar são sintaxe inválida.
  const intervals: ValidityInterval[] = []
  let insideRange = false
  let elementStart = 0
  for (const { 0: char, index } of body.matchAll(MULTIRANGE_DELIMITERS)) {
    if (LOWER_BRACKETS.has(char)) {
      if (insideRange) {
        throw invalidMultirange(text)
      }
      insideRange = true
    } else if (UPPER_BRACKETS.has(char)) {
      if (!insideRange) {
        throw invalidMultirange(text)
      }
      insideRange = false
    } else if (!insideRange) {
      // O único delimitador que sobra é a vírgula; fora de um range, ela separa elementos.
      pushElement(intervals, body.slice(elementStart, index), text)
      elementStart = index + 1
    }
  }
  if (insideRange) {
    throw invalidMultirange(text)
  }
  pushElement(intervals, body.slice(elementStart), text)
  return mergeIntervals(intervals)
}

/** Lê um elemento do multirange (range ou `empty`); elemento em branco (`{,}`) é inválido. */
function pushElement(intervals: ValidityInterval[], element: string, text: string): void {
  if (element.trim() === '') {
    throw invalidMultirange(text)
  }
  const interval = fromPostgresRange(element)
  if (interval !== null) {
    intervals.push(interval)
  }
}
