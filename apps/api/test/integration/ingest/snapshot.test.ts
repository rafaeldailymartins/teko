import { readFileSync } from 'node:fs'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createInMemoryBlobStore } from '#adapters/out/fakes/in-memory-blob-store.ts'
import type { Container } from '#app/container.ts'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import type { SnapshotManifest } from '#app/ports/snapshot-repository.ts'
import { FAMILIES } from '#domain/corpus/family.ts'
import { loadGolden } from '../../../evals/datasets/load-golden.ts'
import { FIXTURE_DIR, seedFixtureCorpus, testContainer } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'
import { createIngestionTestContext, type IngestionTestContext } from '../../setup/ingestion.ts'

/**
 * Snapshot e promoção (DoD da F3): a fixture única é gravada num banco ("staging"), exportada para
 * o store `corpus-snapshots` e promovida num banco vazio ("produção"); a busca híbrida dá os mesmos
 * resultados, na mesma ordem, para todas as perguntas do golden e do `questions.json`. Também:
 * promoção repetida é idempotente, o manifesto confere sha256 e migração, e o store guarda só os 3
 * snapshots mais recentes.
 */

let staging: TestDatabase
let production: TestDatabase
let stagingOwner: pg.Client
let productionOwner: pg.Client
const blobs = createInMemoryBlobStore()
let exporter: IngestionTestContext
let promoter: IngestionTestContext
let manifest: SnapshotManifest
let manifestKey: string

interface Probe {
  readonly question: string
  readonly referenceDate: string
  readonly families: readonly string[]
}

function probes(): Probe[] {
  const golden = loadGolden().map((entry) => ({
    question: entry.question,
    referenceDate:
      entry.expected.reference_date ??
      entry.reference_date ??
      (entry.periodo_apuracao === undefined ? '2026-10-01' : `${entry.periodo_apuracao}-01`),
    families: entry.families ?? FAMILIES,
  }))
  const extra = (
    JSON.parse(readFileSync(`${FIXTURE_DIR}/questions.json`, 'utf8')) as { questions: string[] }
  ).questions.map((question) => ({ question, referenceDate: '2006-05-01', families: FAMILIES }))
  return [...golden, ...extra]
}

async function tableCounts(client: pg.Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of manifest.tables) {
    const { rows } = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM corpus.${table.name}`,
    )
    counts[table.name] = rows[0]?.n ?? 0
  }
  return counts
}

beforeAll(async () => {
  staging = await createTestDatabase()
  production = await createTestDatabase()
  await seedFixtureCorpus(staging.ownerUrl)
  stagingOwner = new pg.Client({ connectionString: staging.ownerUrl })
  productionOwner = new pg.Client({ connectionString: production.ownerUrl })
  await stagingOwner.connect()
  await productionOwner.connect()
  exporter = createIngestionTestContext(staging.ownerUrl, { blobs })
  promoter = createIngestionTestContext(production.ownerUrl, { blobs })
  const exported = await exporter.container.useCases.exportSnapshot({})
  manifest = exported.manifest
  manifestKey = exported.manifestKey
}, 180_000)

afterAll(async () => {
  await exporter?.container.close()
  await promoter?.container.close()
  await stagingOwner?.end()
  await productionOwner?.end()
  await staging?.drop()
  await production?.drop()
})

describe('exportação', () => {
  it('grava um .jsonl.zst por tabela, na ordem de FK, e o manifesto por último', () => {
    expect(manifestKey).toBe('snapshots/1/manifest.json')
    expect(manifest.corpusVersion).toBe(1)
    expect(manifest.migration.name).toMatch(/coverage-gap-entries/)
    expect(blobs.keys(BlobStoreName.CorpusSnapshots)).toEqual(
      [...manifest.tables.map((table) => table.key), manifestKey].sort(),
    )
    const rows = Object.fromEntries(manifest.tables.map((table) => [table.name, table.rows]))
    expect(rows['documents']).toBe(9)
    expect(rows['chunks']).toBeGreaterThan(1500)
    expect(rows['coverage']).toBe(6)
    expect(rows['corpus_versions']).toBe(1)
  })

  it('exporta todas as linhas publicáveis e nenhum dado operacional', async () => {
    const publishable = await stagingOwner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM corpus.chunks WHERE review_status IN ('auto', 'approved')`,
    )
    const chunks = manifest.tables.find((table) => table.name === 'chunks')
    expect(chunks?.rows).toBe(publishable.rows[0]?.n)
    expect(manifest.tables.map((table) => table.name)).not.toContain('embedding_cache')
  })
})

describe('promoção num banco vazio', () => {
  let stagingApi: Container
  let productionApi: Container

  beforeAll(async () => {
    const promoted = await promoter.container.useCases.promoteSnapshot({ manifestKey })
    expect(promoted.corpusVersion).toBe(1)
    expect(promoted.rows).toEqual(
      Object.fromEntries(manifest.tables.map((table) => [table.name, table.rows])),
    )
    stagingApi = testContainer(staging.appUrl)
    productionApi = testContainer(production.appUrl)
  }, 120_000)

  afterAll(async () => {
    await stagingApi?.close()
    await productionApi?.close()
  })

  it('a busca híbrida devolve os mesmos resultados, na mesma ordem, para o golden inteiro', async () => {
    const search = (container: Container) => {
      const retrieval = container.useCases.retrieval
      if (retrieval === null) {
        throw new Error('container sem retrieval')
      }
      return retrieval.hybridSearch
    }
    const cases = probes()
    expect(cases.length).toBeGreaterThan(50)
    let nonEmpty = 0
    for (const probe of cases) {
      const command = {
        question: probe.question,
        referenceDate: probe.referenceDate,
        families: probe.families,
      }
      const expected = await search(stagingApi)(command)
      const actual = await search(productionApi)(command)
      expect(actual, probe.question).toEqual(expected)
      nonEmpty += expected.evidence.length > 0 ? 1 : 0
    }
    expect(nonEmpty).toBeGreaterThan(40)
  })

  it('copia as linhas sem recalcular embeddings e com a mesma cobertura', async () => {
    expect(await tableCounts(productionOwner)).toEqual(
      Object.fromEntries(manifest.tables.map((table) => [table.name, table.rows])),
    )
    const sample = `SELECT id, embedding::text AS embedding FROM corpus.chunks ORDER BY id LIMIT 20`
    expect((await productionOwner.query(sample)).rows).toEqual(
      (await stagingOwner.query(sample)).rows,
    )
    const coverage = `SELECT family, covered::text, verified_at::text, gaps::text, gap_reason
      FROM corpus.coverage ORDER BY family`
    expect((await productionOwner.query(coverage)).rows).toEqual(
      (await stagingOwner.query(coverage)).rows,
    )
  })

  it('promover o mesmo snapshot de novo não muda nada', async () => {
    const before = await tableCounts(productionOwner)
    await promoter.container.useCases.promoteSnapshot({ manifestKey })
    expect(await tableCounts(productionOwner)).toEqual(before)
    const open = await productionOwner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM corpus.provision_versions WHERE NOT upper_inf(knowledge)',
    )
    const stagingClosed = await stagingOwner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM corpus.provision_versions WHERE NOT upper_inf(knowledge)',
    )
    expect(open.rows[0]?.n).toBe(stagingClosed.rows[0]?.n)
  })

  it('mantém o verified_at mais recente da produção e decide a lacuna pela detecção (A1)', async () => {
    const shifted = (ms: number) => new Date(Date.parse(manifest.createdAt) + ms).toISOString()
    const entry = (detectedAt: string, reason: string, sources: string[]) => ({
      sources,
      from: '2026-11-10',
      to: null,
      detectedAt,
      reason,
    })
    // O mark-coverage avançou o verified_at da produção depois da ingestão e marcou duas lacunas:
    // uma vista pelo staging antes da exportação (que a ingestão resolveu: o snapshot vem sem ela)
    // e outra detectada depois da exportação.
    const before = entry(shifted(-3_600_000), 'Decreto já ingerido', ['rcte'])
    const after = entry(shifted(3_600_000), 'Decreto novo', [])
    await productionOwner.query(
      `UPDATE corpus.coverage SET verified_at = '2099-11-20', gaps = '{[2026-11-10,)}',
         gap_reason = 'x', gap_entries = $1::jsonb WHERE family = 'rcte'`,
      [JSON.stringify([before, after])],
    )
    await promoter.container.useCases.promoteSnapshot({ manifestKey })
    const { rows } = await productionOwner.query(
      `SELECT verified_at::text AS verified_at, gaps::text AS gaps, gap_reason, gap_entries
       FROM corpus.coverage WHERE family = 'rcte'`,
    )
    expect(rows[0]).toEqual({
      verified_at: '2099-11-20',
      gaps: '{[2026-11-10,)}',
      gap_reason: 'Decreto novo',
      gap_entries: [after],
    })

    // Sem lacuna nova, a promoção seguinte limpa a da produção que o staging já tinha visto.
    await productionOwner.query(
      `UPDATE corpus.coverage SET gap_entries = $1::jsonb WHERE family = 'rcte'`,
      [JSON.stringify([before])],
    )
    await promoter.container.useCases.promoteSnapshot({ manifestKey })
    const cleared = await productionOwner.query(
      `SELECT gaps::text AS gaps, gap_reason, gap_entries FROM corpus.coverage WHERE family = 'rcte'`,
    )
    expect(cleared.rows[0]).toEqual({ gaps: '{}', gap_reason: null, gap_entries: [] })
  })
})

describe('validações e retenção', () => {
  it('recusa arquivo adulterado', async () => {
    const tampered = createInMemoryBlobStore()
    for (const key of blobs.keys(BlobStoreName.CorpusSnapshots)) {
      const data = await blobs.get(BlobStoreName.CorpusSnapshots, key)
      await tampered.set(BlobStoreName.CorpusSnapshots, key, data ?? new Uint8Array())
    }
    const coverageKey = manifest.tables.find((table) => table.name === 'coverage')?.key ?? ''
    const original =
      (await tampered.get(BlobStoreName.CorpusSnapshots, coverageKey)) ?? new Uint8Array()
    const changed = new Uint8Array(original)
    changed[changed.length - 1] = (changed.at(-1) ?? 0) ^ 0xff
    await tampered.set(BlobStoreName.CorpusSnapshots, coverageKey, changed)
    const target = createIngestionTestContext(production.ownerUrl, { blobs: tampered })
    try {
      await expect(target.container.useCases.promoteSnapshot({ manifestKey })).rejects.toThrow(
        /sha256/,
      )
    } finally {
      await target.container.close()
    }
  })

  it('guarda só os 3 snapshots mais recentes', async () => {
    for (let version = 2; version <= 4; version += 1) {
      await stagingOwner.query(`INSERT INTO corpus.corpus_versions (notes) VALUES ('teste')`)
      const exported = await exporter.container.useCases.exportSnapshot({ corpusVersion: version })
      expect(exported.manifest.corpusVersion).toBe(version)
    }
    const versions = new Set(
      blobs.keys(BlobStoreName.CorpusSnapshots).map((key) => key.split('/')[1]),
    )
    expect([...versions].sort()).toEqual(['2', '3', '4'])
    await expect(exporter.container.useCases.exportSnapshot({ corpusVersion: 3 })).rejects.toThrow(
      /versão atual/,
    )
  })
})
