import { and, eq, inArray } from 'drizzle-orm'
import type { EmbeddingCache } from '#app/ports/embedding-cache.ts'
import type { DrizzleDb } from '../client.ts'
import { embeddingCache } from '../schema/corpus.ts'

/**
 * `corpus.embedding_cache` sobre o Drizzle (owner). Cada `putMany` é um comando (commit próprio,
 * fora da transação da versão de documento): é o checkpoint que permite retomar depois do
 * `budget_exhausted`. Conflito na chave mantém o vetor gravado (o mesmo texto e modelo dão o mesmo
 * vetor; o BGE-M3 é determinístico).
 */

const LOOKUP_BATCH = 500

export function createPgEmbeddingCache(db: DrizzleDb): EmbeddingCache {
  return {
    async getMany(hashes, model) {
      const found = new Map<string, number[]>()
      const unique = [...new Set(hashes)]
      for (let start = 0; start < unique.length; start += LOOKUP_BATCH) {
        const rows = await db
          .select({ hash: embeddingCache.contentHash, embedding: embeddingCache.embedding })
          .from(embeddingCache)
          .where(
            and(
              eq(embeddingCache.model, model),
              inArray(embeddingCache.contentHash, unique.slice(start, start + LOOKUP_BATCH)),
            ),
          )
        for (const row of rows) {
          found.set(row.hash, row.embedding)
        }
      }
      return found
    },
    async putMany(entries, model) {
      if (entries.length === 0) {
        return
      }
      await db
        .insert(embeddingCache)
        .values(
          entries.map((entry) => ({
            contentHash: entry.hash,
            model,
            embedding: [...entry.vector],
          })),
        )
        .onConflictDoNothing()
    },
  }
}
