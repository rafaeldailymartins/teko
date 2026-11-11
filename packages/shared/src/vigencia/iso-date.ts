/**
 * Datas de calendário no formato ISO 8601 estendido `AAAA-MM-DD`, sem hora e sem fuso.
 *
 * Toda a aritmética é feita em "dias desde a época" (UTC), o que evita qualquer efeito de fuso
 * horário ou horário de verão. Strings `AAAA-MM-DD` com ano de 4 dígitos ordenam
 * lexicograficamente na mesma ordem cronológica, então a comparação é feita direto na string.
 */
export type IsoDate = string

/** Menor e maior ano aceitos (os mesmos limites do formato de 4 dígitos, sem o ano zero). */
export const MIN_YEAR = 1
export const MAX_YEAR = 9999

/** Fuso usado para calcular "hoje" no domínio (plano: `America/Sao_Paulo`, via `Clock`). */
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo'

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

export interface CalendarDate {
  readonly year: number
  readonly month: number
  readonly day: number
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

function isValidCalendarDate({ year, month, day }: CalendarDate): boolean {
  return (
    Number.isInteger(year) &&
    Number.isInteger(month) &&
    Number.isInteger(day) &&
    year >= MIN_YEAR &&
    year <= MAX_YEAR &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month)
  )
}

function splitIsoDate(value: string): CalendarDate | undefined {
  const match = ISO_DATE_PATTERN.exec(value)
  if (match === null) {
    return undefined
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

/** `true` quando `value` é uma string `AAAA-MM-DD` que existe no calendário (ex.: rejeita 2023-02-29). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') {
    return false
  }
  const parts = splitIsoDate(value)
  return parts !== undefined && isValidCalendarDate(parts)
}

/** Valida e devolve a data; lança `RangeError` se a string não for uma data real. */
export function parseIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new RangeError(`Data ISO inválida: ${JSON.stringify(value)}`)
  }
  return value
}

/** Decompõe uma data já validada em ano, mês e dia. */
export function toCalendarDate(date: IsoDate): CalendarDate {
  const parts = splitIsoDate(date)
  if (parts === undefined || !isValidCalendarDate(parts)) {
    throw new RangeError(`Data ISO inválida: ${JSON.stringify(date)}`)
  }
  return parts
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

/** Monta uma `IsoDate` a partir de ano, mês (1–12) e dia; lança `RangeError` se não existir. */
export function fromCalendarDate(parts: CalendarDate): IsoDate {
  if (!isValidCalendarDate(parts)) {
    throw new RangeError(`Data de calendário inválida: ${JSON.stringify(parts)}`)
  }
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`
}

/** Número de dias desde 1970-01-01 (negativo antes disso). */
export function toEpochDay(date: IsoDate): number {
  const { year, month, day } = toCalendarDate(date)
  const instant = new Date(0)
  // setUTCFullYear evita o mapeamento legado de anos 0–99 para 1900–1999 do Date.UTC.
  instant.setUTCFullYear(year, month - 1, day)
  return Math.round(instant.getTime() / MS_PER_DAY)
}

/** Inverso de `toEpochDay`; lança `RangeError` fora do intervalo de anos suportado. */
export function fromEpochDay(epochDay: number): IsoDate {
  if (!Number.isSafeInteger(epochDay)) {
    throw new RangeError(`Dia de época inválido: ${String(epochDay)}`)
  }
  const instant = new Date(epochDay * MS_PER_DAY)
  return fromCalendarDate({
    year: instant.getUTCFullYear(),
    month: instant.getUTCMonth() + 1,
    day: instant.getUTCDate(),
  })
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days)
}

/** Ordem cronológica: negativo, zero ou positivo, como em `Array.prototype.sort`. */
export function compareIsoDates(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

/** Primeiro dia do mês da data. */
export function startOfMonth(date: IsoDate): IsoDate {
  const { year, month } = toCalendarDate(date)
  return fromCalendarDate({ year, month, day: 1 })
}

/** Soma (ou subtrai) meses e devolve o dia 1 do mês resultante. */
export function addMonthsToMonthStart(date: IsoDate, months: number): IsoDate {
  const { year, month } = toCalendarDate(date)
  const index = year * 12 + (month - 1) + months
  return fromCalendarDate({ year: Math.floor(index / 12), month: (index % 12) + 1, day: 1 })
}

/**
 * Data de calendário de um instante num fuso IANA (por padrão `America/Sao_Paulo`).
 * É assim que o `Clock` calcula "hoje" para o default de data de referência.
 */
export function isoDateInTimeZone(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): IsoDate {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
  return fromCalendarDate({
    year: Number(parts.get('year')),
    month: Number(parts.get('month')),
    day: Number(parts.get('day')),
  })
}
