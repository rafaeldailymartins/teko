import type { Locale } from '@teko/shared/i18n'
import {
  formatPeriodoApuracao,
  type IsoDate,
  lastIncludedDay,
  type PeriodoApuracao,
  toCalendarDate,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Exibição de datas do domínio. `IsoDate` é data de calendário, sem fuso: a formatação usa UTC para
 * o dia nunca escorregar. O período de apuração é sempre `MM/AAAA`, como nos documentos fiscais.
 */

const formatters = new Map<Locale, Intl.DateTimeFormat>()

function formatterFor(locale: Locale): Intl.DateTimeFormat {
  let formatter = formatters.get(locale)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
    formatters.set(locale, formatter)
  }
  return formatter
}

export function formatIsoDate(date: IsoDate, locale: Locale): string {
  const { year, month, day } = toCalendarDate(date)
  return formatterFor(locale).format(new Date(Date.UTC(year, month - 1, day)))
}

export function formatPeriodo(periodo: PeriodoApuracao): string {
  return formatPeriodoApuracao(periodo)
}

/** Limites exibidos de um intervalo `[from, to)`: o fim é o último dia incluído. */
export interface IntervalDisplay {
  readonly from: string | null
  readonly to: string | null
}

export function intervalDisplay(interval: ValidityInterval, locale: Locale): IntervalDisplay {
  const last = lastIncludedDay(interval)
  return {
    from: interval.from === null ? null : formatIsoDate(interval.from, locale),
    to: last === null ? null : formatIsoDate(last, locale),
  }
}

export const ValidityStatus = {
  Current: 'current',
  Superseded: 'superseded',
  Future: 'future',
} as const
export type ValidityStatus = (typeof ValidityStatus)[keyof typeof ValidityStatus]

/** Situação de uma redação hoje: vigente, superada ou futura (cores `--validity-*`). */
export function validityStatus(interval: ValidityInterval, today: IsoDate): ValidityStatus {
  if (interval.from !== null && interval.from > today) return ValidityStatus.Future
  if (interval.to !== null && interval.to <= today) return ValidityStatus.Superseded
  return ValidityStatus.Current
}
