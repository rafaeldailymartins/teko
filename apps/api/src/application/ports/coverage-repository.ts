import type { FamilyCoverageRecord } from '#domain/vigencia/coverage-decision.ts'

/** Cobertura de todas as famílias e a `corpus_version` atual (`max(corpus_versions.id)`). */
export interface CoverageSnapshot {
  readonly corpusVersion: number
  readonly families: readonly FamilyCoverageRecord[]
}

/** Leitura de `corpus.coverage` (uma linha por família). */
export interface CoverageRepository {
  loadCoverage(): Promise<CoverageSnapshot>
}
