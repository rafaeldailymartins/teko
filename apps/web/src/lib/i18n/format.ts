import { DISPLAY_TIME_ZONE, type Locale } from '@teko/shared/i18n'
import {
  formatPeriodoApuracao,
  type IsoDate,
  lastIncludedDay,
  type PeriodoApuracao,
  parsePeriodoApuracao,
  toCalendarDate,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Formatação de datas por locale, sem depender do fuso de quem roda o código (build, navegador).
 * É o único helper de datas do web: componentes não montam `Intl.DateTimeFormat` nem
 * `new Date('AAAA-MM-DD')` por conta própria.
 *
 * - **Data de calendário** (`AAAA-MM-DD`: vigência, versão de um texto legal) não tem hora nem
 *   fuso: é formatada a partir da meia-noite UTC com `timeZone: 'UTC'`, para não virar o dia
 *   anterior no Brasil. O estilo `numeric` (`01/05/2008`, `05/01/2008`) é o das vigências, dos
 *   badges e do chat; `long`, `medium` e `short` seguem o `dateStyle` do Intl.
 * - **Instante** (`createdAt`, horário de uma pergunta) é exibido no fuso de exibição do app
 *   (`America/Sao_Paulo`), o mesmo do `timeZone` do next-intl.
 * - **Período de apuração** (`AAAA-MM`) tem a forma numérica `MM/AAAA` em todos os idiomas (é a do
 *   SPED e a que o usuário digita) e uma forma por extenso no idioma da UI.
 */

export type DateStyle = 'long' | 'medium' | 'short' | 'numeric'

const DATE_OPTIONS: Readonly<Record<DateStyle, Intl.DateTimeFormatOptions>> = {
  long: { dateStyle: 'long', timeZone: 'UTC' },
  medium: { dateStyle: 'medium', timeZone: 'UTC' },
  short: { dateStyle: 'short', timeZone: 'UTC' },
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' },
}

/** Formatadores reaproveitados (uma linha do tempo formata dezenas de datas por render). */
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(locale: Locale, key: string, options: Intl.DateTimeFormatOptions) {
  const cacheKey = `${locale}|${key}`
  let formatter = formatters.get(cacheKey)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options)
    formatters.set(cacheKey, formatter)
  }
  return formatter
}

function utcDate(date: IsoDate): Date {
  const { year, month, day } = toCalendarDate(date)
  const value = new Date(0)
  // `setUTCFullYear` aceita anos de 1 a 99 sem o deslocamento para 19xx do `Date.UTC`.
  value.setUTCFullYear(year, month - 1, day)
  return value
}

/**
 * Data de calendário por extenso, abreviada ou numérica (`14 de novembro de 2026`,
 * `November 14, 2026`, `01/05/2008`).
 */
export function formatIsoDate(
  locale: Locale,
  date: IsoDate,
  dateStyle: DateStyle = 'long',
): string {
  return formatterFor(locale, dateStyle, DATE_OPTIONS[dateStyle]).format(utcDate(date))
}

/**
 * Intervalo fechado entre duas datas de calendário, com a forma compacta do locale
 * (`1–31 de maio de 2008`). Para um intervalo de vigência semiaberto, passe o último dia incluído.
 */
export function formatIsoDateRange(
  locale: Locale,
  start: IsoDate,
  endInclusive: IsoDate,
  dateStyle: DateStyle = 'long',
): string {
  return formatterFor(locale, dateStyle, DATE_OPTIONS[dateStyle]).formatRange(
    utcDate(start),
    utcDate(endInclusive),
  )
}

/** Limites exibidos de um intervalo `[from, to)`, na forma numérica: o fim é o último dia incluído. */
export interface ValidityBounds {
  readonly from: string | null
  readonly to: string | null
}

export function formatValidityBounds(locale: Locale, interval: ValidityInterval): ValidityBounds {
  const last = lastIncludedDay(interval)
  return {
    from: interval.from === null ? null : formatIsoDate(locale, interval.from, 'numeric'),
    to: last === null ? null : formatIsoDate(locale, last, 'numeric'),
  }
}

/** Instante (ISO 8601 com fuso) no fuso de exibição, com data e hora. */
export function formatInstant(locale: Locale, instant: string | Date): string {
  const value = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`Instante inválido: ${JSON.stringify(instant)}`)
  }
  return formatterFor(locale, 'instant', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: DISPLAY_TIME_ZONE,
  }).format(value)
}

/**
 * Período de apuração: `numeric` dá `03/2024` em qualquer idioma; `long` dá `março de 2024` ou
 * `March 2024`. Aceita `AAAA-MM` ou `MM/AAAA`; lança `RangeError` se não for um período válido.
 */
export function formatTaxPeriod(
  locale: Locale,
  periodo: PeriodoApuracao,
  style: 'numeric' | 'long' = 'numeric',
): string {
  if (style === 'numeric') {
    return formatPeriodoApuracao(periodo)
  }
  return formatterFor(locale, 'month-long', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(`${parsePeriodoApuracao(periodo)}-01`))
}

/** Nome abreviado do mês (1 a 12) no idioma da UI, para a grade do seletor (`mai.`, `May`). */
export function formatMonthName(locale: Locale, month: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Mês inválido: ${month}`)
  }
  return formatterFor(locale, 'month-short', { month: 'short', timeZone: 'UTC' }).format(
    utcDate(`2000-${String(month).padStart(2, '0')}-01`),
  )
}
