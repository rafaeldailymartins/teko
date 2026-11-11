import { ClarificationReason } from '@teko/shared/contracts'
import {
  compareIsoDates,
  defaultReferenceDate,
  hasBoundaryInsidePeriod,
  type IsoDate,
  type PeriodoApuracao,
  periodoApuracaoOf,
  type ReferenceInput,
  ReferenceSource,
  referenceDateFromInput,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { DateGranularity, type DateMention, extractDateMentions } from './date-mentions.ts'

/**
 * Regra de `ResolveReferenceDate` (pura; o caso de uso só injeta "hoje" pelo `Clock`).
 *
 * Precedência:
 * 1. escolha explícita do usuário (`explicit`, `periodo_apuracao` ou `clarified`);
 * 2. data única extraída do texto (`question_text`);
 * 3. `default`: dia 1 do mês anterior a hoje (em `America/Sao_Paulo`).
 *
 * O PA `AAAA-MM` resolve para o dia 1. Se o texto cita uma data que conflita com a escolha
 * explícita, ou datas conflitantes entre si, a resposta é `needs_clarification` com as candidatas.
 * Depois de `needs_clarification`, o cliente reenvia a escolha com `source: 'clarified'`, que não
 * é confrontada com o texto de novo.
 */

export interface ResolveReferenceInput {
  readonly input: ReferenceInput
  readonly source: ReferenceSource
  readonly questionText: string
  /** Hoje em `America/Sao_Paulo`. */
  readonly today: IsoDate
}

export interface ResolvedReference {
  readonly value: IsoDate
  readonly source: ReferenceSource
  /** Calculado depois da busca (`markPeriodBoundary`), quando há vigências para comparar. */
  readonly periodBoundaryInside: boolean
  /** Outras datas plausíveis citadas no texto (compatíveis com a escolhida). */
  readonly alternatives: readonly IsoDate[]
  /** PA da escolha, quando ela foi mensal (para o aviso de fronteira dentro do mês). */
  readonly periodo: PeriodoApuracao | null
}

export const ResolutionKind = {
  Resolved: 'resolved',
  NeedsClarification: 'needs_clarification',
} as const

export type ReferenceResolution =
  | { readonly kind: typeof ResolutionKind.Resolved; readonly reference: ResolvedReference }
  | {
      readonly kind: typeof ResolutionKind.NeedsClarification
      readonly reason: ClarificationReason
      /** Datas candidatas, ordenadas e sem repetição (pelo menos duas). */
      readonly candidates: readonly IsoDate[]
    }

const EXPLICIT_SOURCES: ReadonlySet<ReferenceSource> = new Set([
  ReferenceSource.Explicit,
  ReferenceSource.PeriodoApuracao,
  ReferenceSource.Clarified,
])

function uniqueSorted(dates: readonly IsoDate[]): IsoDate[] {
  return [...new Set(dates)].sort(compareIsoDates)
}

/**
 * Uma menção é compatível com a escolha explícita quando cai na mesma data ou, se a escolha foi um
 * PA (ou a menção é mensal), no mesmo mês.
 */
function isCompatible(mention: DateMention, chosen: IsoDate, chosenIsMonth: boolean): boolean {
  if (mention.value === chosen) {
    return true
  }
  const sameMonth = periodoApuracaoOf(mention.value) === periodoApuracaoOf(chosen)
  return sameMonth && (chosenIsMonth || mention.granularity === DateGranularity.Month)
}

function resolved(
  value: IsoDate,
  source: ReferenceSource,
  periodo: PeriodoApuracao | null,
  alternatives: readonly IsoDate[] = [],
): ReferenceResolution {
  return {
    kind: ResolutionKind.Resolved,
    reference: Object.freeze({
      value,
      source,
      periodBoundaryInside: false,
      alternatives: Object.freeze(uniqueSorted(alternatives.filter((date) => date !== value))),
      periodo,
    }),
  }
}

function clarification(
  reason: ClarificationReason,
  dates: readonly IsoDate[],
): ReferenceResolution {
  return {
    kind: ResolutionKind.NeedsClarification,
    reason,
    candidates: Object.freeze(uniqueSorted(dates)),
  }
}

function resolveExplicit(
  args: ResolveReferenceInput,
  mentions: readonly DateMention[],
): ReferenceResolution {
  const chosen = referenceDateFromInput(args.input)
  const chosenIsMonth = args.input.periodoApuracao !== undefined
  const periodo = chosenIsMonth ? periodoApuracaoOf(chosen) : null
  if (args.source === ReferenceSource.Clarified) {
    return resolved(chosen, args.source, periodo)
  }
  const conflicting = mentions.filter((mention) => !isCompatible(mention, chosen, chosenIsMonth))
  if (conflicting.length > 0) {
    return clarification(ClarificationReason.ExplicitConflict, [
      chosen,
      ...conflicting.map((mention) => mention.value),
    ])
  }
  return resolved(
    chosen,
    args.source,
    periodo,
    mentions.map((mention) => mention.value),
  )
}

export function resolveReferenceDate(args: ResolveReferenceInput): ReferenceResolution {
  const mentions = extractDateMentions(args.questionText)
  if (EXPLICIT_SOURCES.has(args.source)) {
    return resolveExplicit(args, mentions)
  }
  const distinct = uniqueSorted(mentions.map((mention) => mention.value))
  const [only] = distinct
  if (only !== undefined && distinct.length === 1) {
    const isMonth = mentions.every((mention) => mention.granularity === DateGranularity.Month)
    return resolved(only, ReferenceSource.QuestionText, isMonth ? periodoApuracaoOf(only) : null)
  }
  if (distinct.length > 1) {
    return clarification(ClarificationReason.AmbiguousText, distinct)
  }
  const fallback = defaultReferenceDate(args.today)
  return resolved(fallback, ReferenceSource.Default, periodoApuracaoOf(fallback))
}

/**
 * Marca `periodBoundaryInside` quando a data veio de um PA e alguma vigência da evidência começa ou
 * termina dentro do mês: a redação aplicável muda no meio do período, e a UI avisa.
 */
export function markPeriodBoundary(
  reference: ResolvedReference,
  intervals: readonly ValidityInterval[],
): ResolvedReference {
  if (reference.periodo === null) {
    return reference
  }
  const inside = hasBoundaryInsidePeriod(reference.periodo, intervals)
  return inside === reference.periodBoundaryInside
    ? reference
    : Object.freeze({ ...reference, periodBoundaryInside: inside })
}
