import { and, eq, inArray, sql } from 'drizzle-orm'
import type { EmbeddingCache } from '#app/ports/embedding-cache.ts'
import type { DrizzleDb } from '../client.ts'
import { embeddingCache } from '../schema/corpus.ts'

/**
 * `corpus.embedding_cache` sobre o Drizzle (owner). Cada `putMany` é um comando (commit próprio,
 * fora da transação da versão de documento): é o checkpoint que permite retomar depois do
 * `budget_exhausted`. Conflito na chave mantém o vetor gravado (o mesmo texto e modelo dão o mesmo
 * vetor; o BGE-M3 é determinístico).
 *
 * Nenhuma consulta daqui devolve vetor: `cachedHashes` lê só as chaves e a poda (`retainOnly`)
 * manda a lista do que fica para o banco, que apaga o resto lá dentro. O que sai do banco conta na
 * transferência pública do Neon; o que entra, não.
 */

const LOOKUP_BATCH = 500

export function createPgEmbeddingCache(db: DrizzleDb): EmbeddingCache {
  return {
    async cachedHashes(hashes, model) {
      const found = new Set<string>()
      const unique = [...new Set(hashes)]
      for (let start = 0; start < unique.length; start += LOOKUP_BATCH) {
        const rows = await db
          .select({ hash: embeddingCache.contentHash })
          .from(embeddingCache)
          .where(
            and(
              eq(embeddingCache.model, model),
              inArray(embeddingCache.contentHash, unique.slice(start, start + LOOKUP_BATCH)),
            ),
          )
        for (const row of rows) {
          found.add(row.hash)
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
    async retainOnly(model, keep) {
      // Um comando só, com a lista do que fica como parâmetro (entra no banco, não sai): nem os
      // hashes do cache precisam vir para a aplicação.
      const result = await db
        .delete(embeddingCache)
        .where(
          and(
            eq(embeddingCache.model, model),
            sql`${embeddingCache.contentHash} <> ALL(${sql.param([...keep])}::text[])`,
          ),
        )
      return result.rowCount ?? 0
    },
  }
}
