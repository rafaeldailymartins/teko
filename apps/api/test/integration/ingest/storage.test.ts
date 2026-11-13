import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedFixtureCorpus } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Medida do armazenamento (A6/M2): a fixture real (1.574 chunks, vetores BGE-M3 reais) com metade
 * dos chunks com conhecimento fechado, como depois de reprocessamentos e versões corretivas. Antes:
 * vetor mantido nos fechados e HNSW/GIN completos. Depois: vetor apagado nos fechados (a busca
 * nunca os lê) e HNSW/GIN parciais (`WHERE upper_inf(knowledge)`). O tamanho de `corpus.chunks`
 * (tabela, TOAST e índices) é medido com `pg_total_relation_size` depois de `VACUUM FULL`.
 */

let database: TestDatabase
let owner: pg.Client

interface Sizes {
  readonly total: number
  readonly vectors: number
  readonly hnsw: number
  readonly gin: number
}

async function chunksBytes(): Promise<Sizes> {
  await owner.query('VACUUM FULL corpus.chunks')
  const { rows } = await owner.query<Record<keyof Sizes, string>>(
    `SELECT pg_total_relation_size('corpus.chunks')::text AS total,
       (SELECT coalesce(sum(pg_column_size(embedding)), 0) FROM corpus.chunks)::text AS vectors,
       pg_relation_size('corpus.chunks_embedding_hnsw')::text AS hnsw,
       pg_relation_size('corpus.chunks_tsv_gin')::text AS gin`,
  )
  const row = rows[0]
  return {
    total: Number(row?.total ?? 0),
    vectors: Number(row?.vectors ?? 0),
    hnsw: Number(row?.hnsw ?? 0),
    gin: Number(row?.gin ?? 0),
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  await seedFixtureCorpus(database.ownerUrl)
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
  // Metade dos chunks vira histórico (conhecimento fechado).
  await owner.query(`UPDATE corpus.chunks SET knowledge = daterange(lower(knowledge), '2026-11-01')
    WHERE id IN (SELECT id FROM corpus.chunks ORDER BY id LIMIT (SELECT count(*) / 2 FROM corpus.chunks))`)
}, 180_000)

afterAll(async () => {
  await owner?.end()
  await database?.drop()
})

describe('armazenamento de corpus.chunks', () => {
  it('vetor nulo nos fechados e índices parciais reduzem o tamanho', async () => {
    // Antes: índices completos e vetor nos fechados.
    await owner.query(`DROP INDEX corpus.chunks_embedding_hnsw`)
    await owner.query(`DROP INDEX corpus.chunks_tsv_gin`)
    await owner.query(`CREATE INDEX chunks_embedding_hnsw ON corpus.chunks
      USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 128)`)
    await owner.query(`CREATE INDEX chunks_tsv_gin ON corpus.chunks USING gin (tsv)`)
    const before = await chunksBytes()

    // Depois: o que a migração `partial-vector-indexes` e a ingestão fazem.
    await owner.query(`UPDATE corpus.chunks SET embedding = NULL WHERE NOT upper_inf(knowledge)`)
    await owner.query(`DROP INDEX corpus.chunks_embedding_hnsw`)
    await owner.query(`DROP INDEX corpus.chunks_tsv_gin`)
    await owner.query(`CREATE INDEX chunks_embedding_hnsw ON corpus.chunks
      USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 128)
      WHERE upper_inf(knowledge)`)
    await owner.query(
      `CREATE INDEX chunks_tsv_gin ON corpus.chunks USING gin (tsv) WHERE upper_inf(knowledge)`,
    )
    const after = await chunksBytes()

    const kib = (bytes: number) => `${(bytes / 1024).toFixed(0)} KiB`
    const describe = (sizes: Sizes) =>
      `${kib(sizes.total)} (vetores ${kib(sizes.vectors)}, HNSW ${kib(sizes.hnsw)}, GIN ${kib(sizes.gin)})`
    console.warn(
      `corpus.chunks com 50% de histórico: antes ${describe(before)}, depois ${describe(after)}, ` +
        `${(((before.total - after.total) / before.total) * 100).toFixed(1)}% menor`,
    )
    expect(after.vectors).toBeLessThanOrEqual(before.vectors * 0.55)
    expect(after.hnsw).toBeLessThan(before.hnsw)
    expect(after.gin).toBeLessThan(before.gin)
    expect(after.total).toBeLessThan(before.total)
  })
})
