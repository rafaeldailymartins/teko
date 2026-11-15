import { DISPLAY_TIME_ZONE, type Locale } from '@teko/shared/i18n'
import {
  formatPeriodoApuracao,
  type IsoDate,
  type PeriodoApuracao,
  parsePeriodoApuracao,
  toCalendarDate,
} from '@teko/shared/vigencia'

/**
 * Formatação de datas por locale, sem depender do fuso de quem roda o código (build, navegador).
 *
 * - **Data de calendário** (`AAAA-MM-DD`: vigência, versão de um texto legal) não tem hora nem
 *   fuso: é formatada a partir da meia-noite UTC com `timeZone: 'UTC'`, para não virar o dia
 *   anterior no Brasil.
 * - **Instante** (`createdAt`, horário de uma pergunta) é exibido no fuso de exibição do app
 *   (`America/Sao_Paulo`), o mesmo do `timeZone` do next-intl.
 * - **Período de apuração** (`AAAA-MM`) tem a forma numérica `MM/AAAA` em todos os idiomas (é a do
 *   SPED e a que o usuário digita) e uma forma por extenso no idioma da UI.
 */

export type DateStyle = 'long' | 'medium' | 'short'

function utcDate(date: IsoDate): Date {
  const { year, month, day } = toCalendarDate(date)
  const value = new Date(0)
  // `setUTCFullYear` aceita anos de 1 a 99 sem o deslocamento para 19xx do `Date.UTC`.
  value.setUTCFullYear(year, month - 1, day)
  return value
}

/** Data de calendário por extenso ou abreviada (`14 de novembro de 2026`, `November 14, 2026`). */
export function formatIsoDate(
  locale: Locale,
  date: IsoDate,
  dateStyle: DateStyle = 'long',
): string {
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: 'UTC' }).format(utcDate(date))
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
  return new Intl.DateTimeFormat(locale, { dateStyle, timeZone: 'UTC' }).formatRange(
    utcDate(start),
    utcDate(endInclusive),
  )
}

/** Instante (ISO 8601 com fuso) no fuso de exibição, com data e hora. */
export function formatInstant(locale: Locale, instant: string | Date): string {
  const value = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(value.getTime())) {
    throw new RangeError(`Instante inválido: ${JSON.stringify(instant)}`)
  }
  return new Intl.DateTimeFormat(locale, {
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
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(`${parsePeriodoApuracao(periodo)}-01`))
}
