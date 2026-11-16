import {
  addMonthsToMonthStart,
  type IsoDate,
  type PeriodoApuracao,
  periodoApuracaoOf,
  type ReferenceInput,
  ReferenceSource,
  toCalendarDate,
} from '@teko/shared/vigencia'

/**
 * Data de referência no composer. `null` = o usuário não mexeu no chip: a pergunta vai com o mês
 * anterior e `source: 'default'` (a API resolve o mesmo default, ou a data citada no texto). Um
 * período escolhido vai como `periodo_apuracao`; uma data exata, como `explicit`. Depois de um
 * `needs_clarification`, a data escolhida nos botões vai como `clarified`.
 */
export type ReferenceChoice = ReferenceInput | null

/** Campos de data do corpo de `POST /questions` (sempre exatamente um dos dois). */
export type ReferenceRequest =
  | { readonly periodoApuracao: PeriodoApuracao; readonly source: ReferenceSource }
  | { readonly referenceDate: IsoDate; readonly source: ReferenceSource }

/** Mês anterior a hoje: o default da API (`defaultReferenceDate`), em forma de período. */
export function defaultPeriodo(today: IsoDate): PeriodoApuracao {
  return periodoApuracaoOf(addMonthsToMonthStart(today, -1))
}

export function referenceRequest(choice: ReferenceChoice, today: IsoDate): ReferenceRequest {
  if (choice === null) {
    return { periodoApuracao: defaultPeriodo(today), source: ReferenceSource.Default }
  }
  if (choice.periodoApuracao !== undefined) {
    return { periodoApuracao: choice.periodoApuracao, source: ReferenceSource.PeriodoApuracao }
  }
  return { referenceDate: choice.referenceDate, source: ReferenceSource.Explicit }
}

export function clarifiedRequest(date: IsoDate): ReferenceRequest {
  return { referenceDate: date, source: ReferenceSource.Clarified }
}

/**
 * Dia do mês seguinte até o qual a EFD ICMS/IPI do período é entregue (prazo geral do Ajuste
 * SINIEF 2/2009). Até ele, o mês anterior ainda está aberto: o último período fechado é o retrasado.
 */
export const EFD_DELIVERY_DAY = 25

export interface ReferencePresets {
  readonly previousMonth: PeriodoApuracao
  readonly currentMonth: PeriodoApuracao
  readonly lastClosed: PeriodoApuracao
}

export function referencePresets(today: IsoDate): ReferencePresets {
  const previousMonth = defaultPeriodo(today)
  const lastClosed =
    toCalendarDate(today).day > EFD_DELIVERY_DAY
      ? previousMonth
      : periodoApuracaoOf(addMonthsToMonthStart(today, -2))
  return { previousMonth, currentMonth: periodoApuracaoOf(today), lastClosed }
}

/** O que o chip mostra: período ou data, e se é o default. */
export type ReferenceDisplay =
  | { readonly kind: 'periodo'; readonly periodo: PeriodoApuracao; readonly isDefault: boolean }
  | { readonly kind: 'date'; readonly date: IsoDate; readonly isDefault: false }

export function referenceDisplay(choice: ReferenceChoice, today: IsoDate): ReferenceDisplay {
  if (choice === null) {
    return { kind: 'periodo', periodo: defaultPeriodo(today), isDefault: true }
  }
  if (choice.periodoApuracao !== undefined) {
    return { kind: 'periodo', periodo: choice.periodoApuracao, isDefault: false }
  }
  return { kind: 'date', date: choice.referenceDate, isDefault: false }
}

/** Primeiro ano do corpus (RCTE e CTE, desde 1998): o começo da linha do tempo do chat vazio. */
export const CORPUS_START_YEAR = 1998

/**
 * Posição (0 a 1) de uma data na linha do tempo do chat vazio, de 01/01/1998 ao fim do ano de
 * `today`: o ponto âmbar da data de referência anda sobre o fio conforme o período escolhido.
 */
export function corpusTimelinePosition(date: IsoDate, today: IsoDate): number {
  const at = toCalendarDate(date)
  const end = toCalendarDate(today).year + 1
  const value = at.year + (at.month - 1) / 12 + (at.day - 1) / 365
  const position = (value - CORPUS_START_YEAR) / (end - CORPUS_START_YEAR)
  return Math.min(Math.max(position, 0), 1)
}
