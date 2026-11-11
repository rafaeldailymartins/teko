import { addMonthsToMonthStart, type IsoDate, parseIsoDate } from './iso-date.ts'
import { type PeriodoApuracao, periodoApuracaoStart } from './periodo-apuracao.ts'
import type { ValidityInterval } from './validity-interval.ts'

/**
 * Origem da data de referência, em ordem de precedência de `ResolveReferenceDate`:
 * escolha explícita (`explicit`/`periodo_apuracao`) > data única do texto (`question_text`) >
 * `default` (mês anterior). `clarified` é a escolha feita depois de um `needs_clarification`.
 */
export const ReferenceSource = {
  Explicit: 'explicit',
  PeriodoApuracao: 'periodo_apuracao',
  QuestionText: 'question_text',
  Default: 'default',
  Clarified: 'clarified',
} as const

export type ReferenceSource = (typeof ReferenceSource)[keyof typeof ReferenceSource]

/** Data de referência resolvida para uma pergunta. */
export interface ReferenceDate {
  readonly value: IsoDate
  readonly source: ReferenceSource
  /** Há fronteira de `valid_during` dentro do mês do PA: a UI mostra um aviso. */
  readonly periodBoundaryInside: boolean
}

/** O cliente envia sempre uma das duas formas (nunca as duas). */
export type ReferenceInput =
  | { readonly referenceDate: IsoDate; readonly periodoApuracao?: undefined }
  | { readonly periodoApuracao: PeriodoApuracao; readonly referenceDate?: undefined }

/** Data efetiva da entrada do cliente: o PA resolve para o dia 1 do mês. */
export function referenceDateFromInput(input: ReferenceInput): IsoDate {
  if (input.periodoApuracao !== undefined) {
    return periodoApuracaoStart(input.periodoApuracao)
  }
  return parseIsoDate(input.referenceDate)
}

/** Default de data de referência: dia 1 do mês anterior a `today` (calculado em São Paulo). */
export function defaultReferenceDate(today: IsoDate): IsoDate {
  return addMonthsToMonthStart(today, -1)
}

/**
 * `true` quando algum limite de vigência cai estritamente dentro do mês do PA (depois do dia 1 e
 * antes do fim do mês), isto é, quando a redação aplicável muda no meio do período.
 */
export function hasBoundaryInsidePeriod(
  periodo: PeriodoApuracao,
  intervals: readonly ValidityInterval[],
): boolean {
  const start = periodoApuracaoStart(periodo)
  const end = addMonthsToMonthStart(start, 1)
  const inside = (bound: IsoDate | null): boolean => bound !== null && bound > start && bound < end
  return intervals.some((interval) => inside(interval.from) || inside(interval.to))
}
