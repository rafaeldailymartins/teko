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
 * - a instrução inteira fica abaixo de 150 ms (mediana aquecida) nos dois perfis, numa máquina da
 *   velocidade típica do runner do CI.
 *
 * A velocidade do runner do GitHub varia de um run para outro: sem mudança no SQL, a mediana com
 * uma família foi de 96 a 160 ms entre PRs, e as duas medidas sobem juntas no runner lento. Por
 * isso o teto é relativo à máquina: um KNN exato por força bruta sobre os 100k vetores (sem índice
 * nem o SQL da busca, só CPU e leitura do heap) mede a velocidade do runner, e o teto vira
 * `150 ms × max(1, referência ÷ REFERENCE_BASELINE_MS)`. Num runner típico ou mais rápido o teto é
 * 150 ms (nunca afrouxa); num lento, cresce na proporção medida. Regressão da busca continua
 * reprovando, porque a referência não depende dela.
 */

const SEED_SQL = readFileSync(new URL('../../perf/seed/synthetic.sql', import.meta.url), 'utf8')
const LATENCY_BUDGET_MS = 150
/** Mediana da referência num runner típico do CI (`ubuntu-24.04`). Em calibração: infinito = teto fixo. */
const REFERENCE_BASELINE_MS = Number.POSITIVE_INFINITY
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

/**
 * Mediana aquecida de `query(run)`: duas passadas pela mesma sequência, a primeira aquece o cache
 * (shared buffers e páginas do HNSW e do heap) e a segunda é a medida. Uma instância de produção
 * atende consultas o tempo todo; medir a primeira leitura de cada página mediria o disco.
 */
async function warmMedian(label: string, query: (run: number) => Promise<number>): Promise<number> {
  const timings: number[] = []
  for (const measuring of [false, true]) {
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now()
      const rows = await query(run)
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
    `sql-perf [${label}]: mediana ${median.toFixed(1)} ms, máximo ${String(timings.at(-1)?.toFixed(1))} ms`,
  )
  return median
}

function medianLatency(families: readonly string[]): Promise<number> {
  return warmMedian(families.join(','), (run) =>
    inTransaction(async () => {
      const date = `${String(2011 + (run % 14))}-05-01`
      const result = await app.query(HYBRID_SEARCH_SQL, parameters(run + 10, date, families))
      return result.rowCount ?? 0
    }),
  )
}

/** KNN exato por força bruta sobre todos os vetores (o `+ 0` impede o HNSW): velocidade do runner. */
const REFERENCE_SQL = `SELECT c.id FROM corpus.chunks c WHERE c.embedding IS NOT NULL
  ORDER BY (c.embedding <=> $1::halfvec(1024)) + 0 LIMIT 10`

let budget: number | undefined

/** Teto da mediana neste runner: `150 ms × max(1, referência ÷ REFERENCE_BASELINE_MS)`. */
async function latencyBudget(): Promise<number> {
  if (budget === undefined) {
    const reference = await warmMedian('referência: KNN exato sem índice', async (run) => {
      const result = await app.query(REFERENCE_SQL, [toVectorLiteral(randomVector(run + 100))])
      return result.rowCount ?? 0
    })
    const factor = Math.max(1, reference / REFERENCE_BASELINE_MS)
    budget = LATENCY_BUDGET_MS * factor
    console.log(
      `sql-perf: fator da máquina ${factor.toFixed(2)} (referência ${reference.toFixed(1)} ms ÷ ${String(REFERENCE_BASELINE_MS)} ms), teto ${budget.toFixed(1)} ms`,
    )
  }
  return budget
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

  it(`roda abaixo de ${String(LATENCY_BUDGET_MS)} ms com filtro amplo (mediana aquecida, runner típico)`, async () => {
    const limit = await latencyBudget()
    expect(await medianLatency(ALL_FAMILIES)).toBeLessThan(limit)
  })

  it(`roda abaixo de ${String(LATENCY_BUDGET_MS)} ms com uma família (mediana aquecida, runner típico)`, async () => {
    const limit = await latencyBudget()
    expect(await medianLatency(['rcte'])).toBeLessThan(limit)
  })
})
