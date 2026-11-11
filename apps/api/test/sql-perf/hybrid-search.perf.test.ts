import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ARM_LIMIT,
  HNSW_SETTINGS,
  HYBRID_SEARCH_SQL,
  toVectorLiteral,
} from '#adapters/out/persistence/drizzle/sql/hybrid-search.ts'
import { createTestDatabase, type TestDatabase } from '../setup/database.ts'

/**
 * `sql-perf` (plano: Busca híbrida > Testes), sobre ~100k chunks sintéticos
 * (`perf/seed/synthetic.sql`; numa data, ~25% das linhas em vigor, ~4% numa família só):
 *
 * - com filtro amplo, o plano usa o HNSW (`chunks_embedding_hnsw`), o GIN do `tsv` e o GiST de
 *   (family, valid_during), sem `Seq Scan` em `corpus.chunks`; com filtro seletivo, o Postgres troca
 *   o HNSW pelo KNN exato sobre o GiST (mais barato e exato), e continua sem `Seq Scan`;
 * - com o HNSW forçado e filtro seletivo, o braço vetorial devolve k linhas (iterative scan do
 *   pgvector 0.8, `relaxed_order`);
 * - a instrução inteira fica abaixo de 150 ms (mediana aquecida) nos dois perfis.
 */

const SEED_SQL = readFileSync(new URL('../../perf/seed/synthetic.sql', import.meta.url), 'utf8')
const LATENCY_BUDGET_MS = 150
const RUNS = 15
const ALL_FAMILIES = ['efd-icms-ipi', 'efd-reinf', 'rcte', 'cte', 'efd-go', 'tabelas-go']
const QUESTION = 'prazo de pagamento do imposto no regime especial de substituição tributária'

let database: TestDatabase
let app: pg.Client

function randomVector(seed: number): number[] {
  let state = seed
  return Array.from({ length: 1024 }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648 - 0.5
  })
}

function parameters(seed: number, date: string, families: readonly string[]) {
  return [
    QUESTION,
    toVectorLiteral(randomVector(seed)),
    date,
    families,
    ['synthetic:rcte:17'],
    ['auto', 'approved'],
    12,
  ]
}

async function inTransaction<T>(run: () => Promise<T>, extra: readonly string[] = []): Promise<T> {
  await app.query('BEGIN READ ONLY')
  try {
    for (const statement of [...HNSW_SETTINGS, ...extra]) {
      await app.query(statement)
    }
    return await run()
  } finally {
    await app.query('ROLLBACK')
  }
}

interface PlanNode {
  readonly 'Node Type': string
  readonly 'Relation Name'?: string
  readonly 'Index Name'?: string
  readonly Plans?: readonly PlanNode[]
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)]
}

async function explain(sql: string, params: unknown[], extra: readonly string[] = []) {
  const plan = await inTransaction(async () => {
    const { rows } = await app.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
      `EXPLAIN (FORMAT JSON) ${sql}`,
      params,
    )
    return rows[0]?.['QUERY PLAN'][0].Plan
  }, extra)
  if (plan === undefined) {
    throw new Error('EXPLAIN sem plano')
  }
  const nodes = flatten(plan)
  return {
    indexes: new Set(nodes.map((node) => node['Index Name']).filter(Boolean)),
    chunkSeqScans: nodes.filter(
      (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'chunks',
    ),
  }
}

async function medianLatency(families: readonly string[]): Promise<number> {
  const timings: number[] = []
  // Duas passadas pela mesma sequência de consultas: a primeira aquece o cache (shared buffers e
  // páginas do HNSW e do heap), a segunda é a medida. Uma instância de produção atende consultas o
  // tempo todo; medir a primeira leitura de cada página mediria o disco, não a instrução.
  for (const measuring of [false, true]) {
    for (let run = 0; run < RUNS; run += 1) {
      const date = `${String(2011 + (run % 14))}-05-01`
      const started = performance.now()
      const rows = await inTransaction(async () => {
        const result = await app.query(HYBRID_SEARCH_SQL, parameters(run + 10, date, families))
        return result.rowCount
      })
      const elapsed = performance.now() - started
      expect(rows).toBeGreaterThan(0)
      if (measuring) {
        timings.push(elapsed)
      }
    }
  }
  timings.sort((a, b) => a - b)
  const median = timings[Math.floor(timings.length / 2)] ?? Number.POSITIVE_INFINITY
  console.log(
    `sql-perf [${families.join(',')}]: mediana ${median.toFixed(1)} ms, máximo ${String(timings.at(-1)?.toFixed(1))} ms`,
  )
  return median
}

beforeAll(async () => {
  database = await createTestDatabase()
  const owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
  try {
    await owner.query(SEED_SQL)
    await owner.query(
      'VACUUM (ANALYZE) corpus.documents, corpus.document_versions, corpus.provisions, corpus.provision_versions, corpus.chunks, corpus.chunk_sources',
    )
  } finally {
    await owner.end()
  }
  app = new pg.Client({ connectionString: database.appUrl })
  await app.connect()
}, 900_000)

afterAll(async () => {
  await app?.end()
  await database?.drop()
})

describe('busca híbrida sobre 100k chunks', () => {
  it('tem ~100k chunks sintéticos com embedding', async () => {
    const { rows } = await app.query<{ total: number }>(
      'SELECT count(*)::int AS total FROM corpus.chunks WHERE embedding IS NOT NULL',
    )
    expect(rows[0]?.total).toBeGreaterThanOrEqual(100_000)
  })

  it('com filtro amplo usa HNSW, GIN e GiST, sem Seq Scan em corpus.chunks', async () => {
    const { indexes, chunkSeqScans } = await explain(
      HYBRID_SEARCH_SQL,
      parameters(1, '2015-06-01', ALL_FAMILIES),
    )
    expect(indexes).toContain('chunks_embedding_hnsw')
    expect(indexes).toContain('chunks_tsv_gin')
    expect(indexes).toContain('chunks_family_valid_during_gist')
    expect(chunkSeqScans).toEqual([])
  })

  it('com filtro seletivo usa o GiST, sem Seq Scan em corpus.chunks', async () => {
    const { indexes, chunkSeqScans } = await explain(
      HYBRID_SEARCH_SQL,
      parameters(2, '2015-06-01', ['rcte']),
    )
    expect(indexes).toContain('chunks_family_valid_during_gist')
    expect(indexes).toContain('chunks_tsv_gin')
    expect(chunkSeqScans).toEqual([])
  })

  it('o ANN pelo HNSW com filtro seletivo devolve k linhas (iterative scan)', async () => {
    const annSql = `SELECT c.id FROM corpus.chunks c
      WHERE c.embedding IS NOT NULL AND c.valid_during @> $2::date AND upper_inf(c.knowledge)
        AND c.family = ANY($3::text[]) AND c.review_status = ANY($4::text[])
      ORDER BY c.embedding <=> $1::halfvec(1024) LIMIT ${String(ARM_LIMIT)}`
    const params = [
      toVectorLiteral(randomVector(7)),
      '2016-03-01',
      ['tabelas-go'],
      ['auto', 'approved'],
    ]
    // Sem bitmap e sem seq scan, o único caminho é o HNSW: é ele que precisa achar k linhas
    // mesmo descartando ~96% dos vizinhos pelo filtro.
    const forceHnsw = ['SET LOCAL enable_bitmapscan = off', 'SET LOCAL enable_seqscan = off']
    const { indexes } = await explain(annSql, params, forceHnsw)
    expect(indexes).toContain('chunks_embedding_hnsw')
    const count = await inTransaction(
      async () => (await app.query(annSql, params)).rowCount,
      forceHnsw,
    )
    expect(count).toBe(ARM_LIMIT)
  })

  it(`roda abaixo de ${String(LATENCY_BUDGET_MS)} ms com filtro amplo (mediana aquecida)`, async () => {
    expect(await medianLatency(ALL_FAMILIES)).toBeLessThan(LATENCY_BUDGET_MS)
  })

  it(`roda abaixo de ${String(LATENCY_BUDGET_MS)} ms com uma família (mediana aquecida)`, async () => {
    expect(await medianLatency(['rcte'])).toBeLessThan(LATENCY_BUDGET_MS)
  })
})
