import { sql } from 'drizzle-orm'
import type { FixtureCorpusStore } from '#app/ports/fixture-corpus-store.ts'
import { jurisdictionOf } from '#domain/corpus/family.ts'
import type { DrizzleDb } from '../client.ts'
import { coverage } from '../schema/corpus.ts'

/**
 * `FixtureCorpusStore` sobre o Drizzle (URL do owner). Só o seed da fixture usa: esvaziar o corpus
 * (`--replace`) e gravar a cobertura declarada, na `corpus_version` atual.
 */
export function createPgFixtureCorpusStore(db: DrizzleDb): FixtureCorpusStore {
  return {
    async clearCorpus() {
      await db.execute(sql`TRUNCATE corpus.chunk_sources, corpus.chunks, corpus.provision_versions,
        corpus.provision_labels, corpus.amendments, corpus.review_queue, corpus.provisions,
        corpus.document_versions, corpus.documents, corpus.coverage, corpus.corpus_versions,
        corpus.embedding_cache, corpus.ingestion_runs RESTART IDENTITY`)
    },
    async declareCoverage(entries) {
      if (entries.length === 0) {
        return
      }
      await db.transaction(async (tx) => {
        const current = await tx.execute<{ id: number | null }>(
          sql`SELECT max(id) AS id FROM corpus.corpus_versions`,
        )
        const corpusVersion = current.rows[0]?.id ?? 0
        for (const entry of entries) {
          const values = {
            family: entry.family,
            jurisdiction: jurisdictionOf(entry.family),
            covered: [...entry.covered],
            verifiedAt: entry.verifiedAt,
            corpusVersion,
            gaps: [...entry.gaps],
            gapReason: entry.gapReason,
          }
          await tx
            .insert(coverage)
            .values(values)
            .onConflictDoUpdate({ target: coverage.family, set: values })
        }
      })
    },
  }
}
