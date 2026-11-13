import type { CoverageRepository } from '#app/ports/coverage-repository.ts'
import { type DrizzleDb, retryTransientRead } from '../client.ts'
import { coverage } from '../schema/corpus.ts'

/**
 * Lê `corpus.coverage` inteira (uma linha por família; poucas linhas). Leitura idempotente: um
 * retry numa conexão nova se a primeira cair (scale-to-zero do Neon).
 */
export function createPgCoverageRepository(db: DrizzleDb): CoverageRepository {
  return {
    loadCoverage: () =>
      retryTransientRead(async () => {
        const rows = await db.select().from(coverage).orderBy(coverage.family)
        return rows.map((row) => ({
          family: row.family,
          jurisdiction: row.jurisdiction === 'BR' ? 'BR' : 'GO',
          covered: row.covered,
          verifiedAt: row.verifiedAt,
          gaps: row.gaps,
        }))
      }),
  }
}
