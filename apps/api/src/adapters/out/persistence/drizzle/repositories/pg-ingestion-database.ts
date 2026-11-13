import { sql } from 'drizzle-orm'
import type { DatabaseUsage, VectorIndexMaintenance } from '#app/ports/database-usage.ts'
import type { DrizzleDb } from '../client.ts'

/**
 * Medida e manutenção do banco para a ingestão (owner):
 * - tamanho por `pg_database_size(current_database())` (o que o Neon conta contra o limite);
 * - HNSW de `corpus.chunks` (`chunks_embedding_hnsw`, `m=16`, `ef_construction=128`, como no schema)
 *   derrubado e recriado pelo `--bulk`. A recriação roda numa transação com
 *   `SET LOCAL maintenance_work_mem = '256MB'` (a compute do Neon tem ~1 GB; o `SET` de sessão não passa pelo pooler, e a
 *   ingestão usa a URL direta, mas o `LOCAL` não vaza para outras transações da conexão).
 */

const HNSW_INDEX = 'chunks_embedding_hnsw'

export function createPgDatabaseUsage(db: DrizzleDb): DatabaseUsage {
  return {
    async sizeBytes() {
      const result = await db.execute<{ bytes: string }>(
        sql`SELECT pg_database_size(current_database())::text AS bytes`,
      )
      return Number(result.rows[0]?.bytes ?? 0)
    },
  }
}

export function createPgVectorIndexMaintenance(db: DrizzleDb): VectorIndexMaintenance {
  return {
    async dropVectorIndex() {
      await db.execute(sql.raw(`DROP INDEX IF EXISTS corpus.${HNSW_INDEX}`))
    },
    async ensureVectorIndex() {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL maintenance_work_mem = '256MB'`)
        await tx.execute(
          sql.raw(`CREATE INDEX IF NOT EXISTS ${HNSW_INDEX} ON corpus.chunks
            USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 128)
            WHERE upper_inf(knowledge)`),
        )
      })
    },
  }
}
