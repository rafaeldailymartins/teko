import {
  addDays,
  containsDate,
  type IsoDate,
  isoDateInTimeZone,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Vigência na UI: o estado de uma redação em relação a hoje (a cor do badge, pelos tokens
 * `--validity-*`) e a escolha da redação vigente numa data, sobre a linha do tempo da API (em
 * ordem cronológica, intervalos `[from, to)`).
 */

export const ValidityStatus = {
  Current: 'current',
  Superseded: 'superseded',
  Future: 'future',
} as const
export type ValidityStatus = (typeof ValidityStatus)[keyof typeof ValidityStatus]

/**
 * Data de calendário como instante à meia-noite UTC, para o `format.dateTime` do next-intl com
 * `timeZone: 'UTC'`: no fuso do app (São Paulo), `2008-05-01` viraria 30/04.
 */
export function calendarDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`)
}

/** Opções de formatação das datas de calendário (dia, mês e ano, sem fuso). */
export const CALENDAR_DATE_FORMAT = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
} as const satisfies Intl.DateTimeFormatOptions

/** Opções de formatação de um mês (período de apuração). */
export const MONTH_FORMAT = {
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
} as const satisfies Intl.DateTimeFormatOptions

/** Hoje em America/Sao_Paulo (a mesma regra da API para "hoje"). */
export function todayIsoDate(now: Date = new Date()): IsoDate {
  return isoDateInTimeZone(now)
}

/** Vigente hoje, revogada (acabou antes de hoje) ou futura (começa depois de hoje). */
export function validityStatus(interval: ValidityInterval, today: IsoDate): ValidityStatus {
  if (containsDate(interval, today)) {
    return ValidityStatus.Current
  }
  return interval.from !== null && interval.from > today
    ? ValidityStatus.Future
    : ValidityStatus.Superseded
}

/** Índice da redação vigente na data, ou `-1` se o dispositivo não existia nela. */
export function versionIndexAt(
  versions: readonly { readonly validity: ValidityInterval }[],
  date: IsoDate,
): number {
  return versions.findIndex((version) => containsDate(version.validity, date))
}

/**
 * Redação a mostrar numa data: a vigente nela; sem nenhuma, a última que começou antes da data
 * (o texto que acabou de sair) ou, se a data é anterior a todas, a primeira.
 */
export function displayedVersionIndex(
  versions: readonly { readonly validity: ValidityInterval }[],
  date: IsoDate,
): number {
  if (versions.length === 0) {
    return -1
  }
  const exact = versionIndexAt(versions, date)
  if (exact !== -1) {
    return exact
  }
  const before = versions.findLastIndex(
    (version) => version.validity.from === null || version.validity.from <= date,
  )
  return before === -1 ? 0 : before
}

/**
 * Uma data em que a redação está vigente, para selecioná-la pela URL ou pedir o diff: o primeiro
 * dia; sem começo conhecido, o último dia; sem nenhum dos dois (vigente sempre), `fallback`.
 */
export function dateWithin(interval: ValidityInterval, fallback: IsoDate): IsoDate {
  if (interval.from !== null) {
    return interval.from
  }
  return interval.to === null ? fallback : addDays(interval.to, -1)
}
