import type { FamilyCoverageRecord } from '#domain/vigencia/coverage-decision.ts'

/** Leitura de `corpus.coverage` (uma linha por família). */
export interface CoverageRepository {
  loadCoverage(): Promise<FamilyCoverageRecord[]>
}
