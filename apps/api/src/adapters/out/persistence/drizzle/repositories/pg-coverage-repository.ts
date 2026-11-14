import { max } from 'drizzle-orm'
import type { CoverageRepository } from '#app/ports/coverage-repository.ts'
import { type DrizzleDb, retryTransientRead } from '../client.ts'
import { corpusVersions, coverage } from '../schema/corpus.ts'

/**
 * Lê `corpus.coverage` inteira (uma linha por família; poucas linhas) e a `corpus_version` atual
 * (`max(corpus_versions.id)`, 0 num banco sem corpus). Leitura idempotente: um retry numa conexão
 * nova se a primeira cair (scale-to-zero do Neon).
 */
export function createPgCoverageRepository(db: DrizzleDb): CoverageRepository {
  return {
    loadCoverage: () =>
      retryTransientRead(async () => {
        const [rows, versions] = await Promise.all([
          db.select().from(coverage).orderBy(coverage.family),
          db.select({ id: max(corpusVersions.id) }).from(corpusVersions),
        ])
        return {
          corpusVersion: versions[0]?.id ?? 0,
          families: rows.map((row) => ({
            family: row.family,
            jurisdiction: row.jurisdiction === 'BR' ? 'BR' : 'GO',
            covered: row.covered,
            verifiedAt: row.verifiedAt,
            gaps: row.gaps,
          })),
        }
      }),
  }
}
