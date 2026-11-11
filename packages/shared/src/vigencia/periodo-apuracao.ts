import {
  addMonthsToMonthStart,
  fromCalendarDate,
  type IsoDate,
  MAX_YEAR,
  MIN_YEAR,
  toCalendarDate,
} from './iso-date.ts'
import { createInterval, type ValidityInterval } from './validity-interval.ts'

/**
 * Período de apuração (PA) mensal. A forma canônica, usada na API, nas URLs (`?ref=2024-03`) e
 * no banco, é `AAAA-MM`. A forma de exibição, usada no chip da UI e no SPED, é `MM/AAAA`.
 */
export type PeriodoApuracao = string

const CANONICAL_PATTERN = /^(\d{4})-(\d{2})$/
const DISPLAY_PATTERN = /^(\d{2})\/(\d{4})$/

function build(year: number, month: number): PeriodoApuracao | undefined {
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) {
    return undefined
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/** `true` apenas para a forma canônica `AAAA-MM` com mês 01–12. */
export function isPeriodoApuracao(value: unknown): value is PeriodoApuracao {
  if (typeof value !== 'string') {
    return false
  }
  const match = CANONICAL_PATTERN.exec(value)
  return match !== null && build(Number(match[1]), Number(match[2])) === value
}

/**
 * Aceita `AAAA-MM` ou `MM/AAAA` (com espaços nas pontas) e devolve a forma canônica `AAAA-MM`.
 * Lança `RangeError` se o texto não for um período válido.
 */
export function parsePeriodoApuracao(input: string): PeriodoApuracao {
  const value = input.trim()
  const canonical = CANONICAL_PATTERN.exec(value)
  const display = canonical === null ? DISPLAY_PATTERN.exec(value) : null
  let result: PeriodoApuracao | undefined
  if (canonical !== null) {
    result = build(Number(canonical[1]), Number(canonical[2]))
  } else if (display !== null) {
    result = build(Number(display[2]), Number(display[1]))
  }
  if (result === undefined) {
    throw new RangeError(`Período de apuração inválido: ${JSON.stringify(input)}`)
  }
  return result
}

/** O PA resolve para o dia 1 do mês (regra de `ResolveReferenceDate`). */
export function periodoApuracaoStart(periodo: PeriodoApuracao): IsoDate {
  return `${parsePeriodoApuracao(periodo)}-01`
}

/** PA que contém a data. */
export function periodoApuracaoOf(date: IsoDate): PeriodoApuracao {
  return fromCalendarDate({ ...toCalendarDate(date), day: 1 }).slice(0, 7)
}

/** Forma de exibição `MM/AAAA`. */
export function formatPeriodoApuracao(periodo: PeriodoApuracao): string {
  const canonical = parsePeriodoApuracao(periodo)
  return `${canonical.slice(5, 7)}/${canonical.slice(0, 4)}`
}

/** Soma (ou subtrai) meses ao PA. */
export function shiftPeriodoApuracao(periodo: PeriodoApuracao, months: number): PeriodoApuracao {
  return addMonthsToMonthStart(periodoApuracaoStart(periodo), months).slice(0, 7)
}

/** O mês inteiro do PA como intervalo `[dia 1, dia 1 do mês seguinte)`. */
export function periodoApuracaoInterval(periodo: PeriodoApuracao): ValidityInterval {
  const start = periodoApuracaoStart(periodo)
  return createInterval(start, addMonthsToMonthStart(start, 1))
}
