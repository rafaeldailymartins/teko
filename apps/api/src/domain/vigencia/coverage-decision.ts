import type { FamilyCoverage, Jurisdiction } from '@teko/shared/contracts'
import {
  effectiveCoverage,
  type IsoDate,
  isDateCovered,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Regra de `CheckCoverage` (pura). A cobertura efetiva de uma família é
 * `covered * datemultirange(daterange(NULL, verified_at + 1)) - gaps`: uma data posterior ao
 * `verified_at` (que o source-watch avança todo dia) fica fora, e a pergunta é recusada como
 * `out_of_coverage` sem chamar o LLM.
 *
 * - Nenhuma família pedida cobre a data: recusa, com os intervalos cobertos de cada família.
 * - Cobertura parcial: a busca segue só nas famílias cobertas; as demais vão para
 *   `data-meta.uncoveredFamilies`.
 * - Família pedida sem registro de cobertura (ex.: `rcte-anexos` antes da C3) conta como não
 *   coberta.
 */

export interface FamilyCoverageRecord {
  readonly family: string
  readonly jurisdiction: Jurisdiction
  readonly covered: readonly ValidityInterval[]
  readonly verifiedAt: IsoDate
  readonly gaps: readonly ValidityInterval[]
}

export const CoverageStatus = {
  Covered: 'covered',
  Partial: 'partial',
  OutOfCoverage: 'out_of_coverage',
} as const
export type CoverageStatus = (typeof CoverageStatus)[keyof typeof CoverageStatus]

export interface CoverageDecision {
  readonly status: CoverageStatus
  readonly coveredFamilies: readonly string[]
  readonly uncoveredFamilies: readonly string[]
  /** Cobertura efetiva das famílias pedidas que existem no corpus (para sugerir datas). */
  readonly coverage: readonly FamilyCoverage[]
}

export function effectiveFamilyCoverage(record: FamilyCoverageRecord): FamilyCoverage {
  return {
    family: record.family,
    jurisdiction: record.jurisdiction,
    covered: effectiveCoverage(record.covered, record.verifiedAt, record.gaps),
    verifiedAt: record.verifiedAt,
  }
}

/**
 * @param requested famílias pedidas; vazio = todas as famílias com registro de cobertura.
 */
export function decideCoverage(
  date: IsoDate,
  requested: readonly string[],
  records: readonly FamilyCoverageRecord[],
): CoverageDecision {
  const byFamily = new Map(records.map((record) => [record.family, record]))
  const families = requested.length > 0 ? [...new Set(requested)] : [...byFamily.keys()]
  const coverage: FamilyCoverage[] = []
  const coveredFamilies: string[] = []
  const uncoveredFamilies: string[] = []
  for (const family of families) {
    const record = byFamily.get(family)
    const effective = record === undefined ? undefined : effectiveFamilyCoverage(record)
    if (effective !== undefined) {
      coverage.push(effective)
    }
    if (effective !== undefined && isDateCovered(date, effective.covered)) {
      coveredFamilies.push(family)
    } else {
      uncoveredFamilies.push(family)
    }
  }
  let status: CoverageStatus = CoverageStatus.Partial
  if (coveredFamilies.length === 0) {
    status = CoverageStatus.OutOfCoverage
  } else if (uncoveredFamilies.length === 0) {
    status = CoverageStatus.Covered
  }
  return { status, coveredFamilies, uncoveredFamilies, coverage }
}
