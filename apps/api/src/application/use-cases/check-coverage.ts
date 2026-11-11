import type { IsoDate } from '@teko/shared/vigencia'
import { type CoverageDecision, decideCoverage } from '#domain/vigencia/coverage-decision.ts'
import type { CoverageRepository } from '../ports/coverage-repository.ts'

/**
 * `CheckCoverage`: decide se as famílias pedidas cobrem a data de referência. Uma data posterior ao
 * `verified_at` recusa sem chamar o LLM.
 */
export type CheckCoverage = (
  date: IsoDate,
  families: readonly string[],
) => Promise<CoverageDecision>

export function createCheckCoverage(deps: {
  readonly coverageRepository: CoverageRepository
}): CheckCoverage {
  return async (date, families) =>
    decideCoverage(date, families, await deps.coverageRepository.loadCoverage())
}
