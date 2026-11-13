import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type { Family } from '#domain/corpus/family.ts'

/**
 * O que o seed da fixture faz no banco além da ingestão (URL do owner; só desenvolvimento, CI e
 * testes, nunca num ambiente real).
 */

/** Cobertura declarada no `coverage.json` da fixture (a mesma que o staging tinha na exportação). */
export interface DeclaredCoverage {
  readonly family: Family
  readonly covered: readonly ValidityInterval[]
  readonly verifiedAt: IsoDate
  readonly gaps: readonly ValidityInterval[]
  readonly gapReason: string | null
}

export interface FixtureCorpusStore {
  /** Esvazia o schema `corpus` (com o cache de embeddings e os runs). */
  clearCorpus(): Promise<void>
  /**
   * Grava a cobertura declarada por cima da que o `RefreshCoverage` derivou (upsert por família,
   * na `corpus_version` atual): a fixture é um recorte do staging, e a união das vigências do
   * recorte não é a cobertura que o staging tinha.
   */
  declareCoverage(entries: readonly DeclaredCoverage[]): Promise<void>
}
