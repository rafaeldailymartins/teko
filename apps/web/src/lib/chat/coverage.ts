import type { FamilyCoverage } from '@teko/shared/contracts'
import { type IsoDate, isDateCovered } from '@teko/shared/vigencia'

/**
 * Cobertura do corpus na data de referência, para o indicador do composer e o `CoverageBanner`:
 * fundamentada (todas as famílias cobrem a data), parcial (algumas) ou fora de cobertura (nenhuma).
 * É só aviso: o envio continua permitido, e a API recusa formalmente o que estiver fora.
 */
export const CoverageStatus = {
  Grounded: 'grounded',
  Partial: 'partial',
  Out: 'out',
} as const
export type CoverageStatus = (typeof CoverageStatus)[keyof typeof CoverageStatus]

export interface CoverageAtDate {
  readonly status: CoverageStatus
  /** Famílias sem cobertura na data, na ordem da API. */
  readonly uncovered: readonly string[]
}

export function coverageAt(families: readonly FamilyCoverage[], date: IsoDate): CoverageAtDate {
  const uncovered = families
    .filter((family) => !isDateCovered(date, family.covered))
    .map((family) => family.family)
  if (uncovered.length === 0) {
    return { status: CoverageStatus.Grounded, uncovered }
  }
  return {
    status: uncovered.length === families.length ? CoverageStatus.Out : CoverageStatus.Partial,
    uncovered,
  }
}
