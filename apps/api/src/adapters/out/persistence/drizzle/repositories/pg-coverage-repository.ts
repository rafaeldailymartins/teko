import type { CoverageRepository } from '#app/ports/coverage-repository.ts'
import type { DrizzleDb } from '../client.ts'
import { coverage } from '../schema/corpus.ts'

/** Lê `corpus.coverage` inteira (uma linha por família; poucas linhas). */
export function createPgCoverageRepository(db: DrizzleDb): CoverageRepository {
  return {
    async loadCoverage() {
      const rows = await db.select().from(coverage).orderBy(coverage.family)
      return rows.map((row) => ({
        family: row.family,
        jurisdiction: row.jurisdiction === 'BR' ? 'BR' : 'GO',
        covered: row.covered,
        verifiedAt: row.verifiedAt,
        gaps: row.gaps,
      }))
    },
  }
}
