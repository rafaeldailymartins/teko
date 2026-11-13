import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SeedFixtureCorpusResult } from '#app/use-cases/seed-fixture-corpus.ts'
import { seedFixtureCorpus } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Seed da fixture única pelo caminho da ingestão real (`IngestDocumentVersion`, como owner) e
 * restrições do schema:
 * - o seed grava as 12 versões de documento num run `fixture`, com uma `corpus_version` e a
 *   cobertura declarada; repetido, não duplica nada;
 * - `pv_no_overlap` impede redações publicáveis sobrepostas do mesmo dispositivo, mas deixa passar
 *   uma anomalia `pending` (que vai para a review_queue sem abortar o documento);
 * - o `tsv` é gerado com `immutable_unaccent`, e toda redação vigente tem fonte publicada.
 */

let database: TestDatabase
let owner: pg.Client
let seeded: SeedFixtureCorpusResult

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await owner.query<{ value: T }>(sql, params)
  return rows[0]?.value as T
}

beforeAll(async () => {
  database = await createTestDatabase()
  seeded = await seedFixtureCorpus(database.ownerUrl)
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
}, 120_000)

afterAll(async () => {
  await owner?.end()
  await database?.drop()
})

describe('seed da fixture', () => {
  it('ingere as versões de documento pelo caminho da ingestão real', async () => {
    expect(seeded).toMatchObject({
      corpusVersion: 1,
      documentVersions: 12,
      unchanged: 0,
      provisionVersions: 1569,
      chunks: 1574,
    })
    expect(
      await scalar<number>(
        `SELECT count(*)::int AS value FROM corpus.document_versions WHERE status = 'published'`,
      ),
    ).toBe(12)
    expect(
      await scalar<number>('SELECT count(*)::int AS value FROM corpus.provision_versions'),
    ).toBe(1569)
    // Redações iguais em duas versões do mesmo Guia ou leiaute são uma linha só, com duas fontes.
    expect(
      await scalar<number>(`SELECT count(*)::int AS value FROM (SELECT s.chunk_id
        FROM corpus.chunk_sources s GROUP BY s.chunk_id HAVING count(*) > 1) shared`),
    ).toBeGreaterThan(0)
    // Os vetores ficaram no cache de embeddings, como num run real.
    expect(
      await scalar<number>('SELECT count(*)::int AS value FROM corpus.embedding_cache'),
    ).toBeGreaterThan(1000)
  })

  it('a cobertura é a declarada na fixture, na corpus_version do seed', async () => {
    const { rows } = await owner.query<{ family: string; covered: string; verified_at: string }>(
      `SELECT family, covered::text AS covered, verified_at::text AS verified_at
       FROM corpus.coverage WHERE corpus_version = 1 ORDER BY family`,
    )
    expect(rows).toContainEqual({
      family: 'rcte',
      covered: '{[1998-01-01,)}',
      verified_at: '2026-11-10',
    })
    expect(rows.every((row) => row.verified_at === '2026-11-10')).toBe(true)
  })

  it('repetido, não duplica nada nem abre outra corpus_version', async () => {
    const again = await seedFixtureCorpus(database.ownerUrl)
    expect(again).toMatchObject({
      corpusVersion: 1,
      unchanged: 12,
      provisionVersions: 0,
      chunks: 0,
    })
    expect(await scalar<number>('SELECT count(*)::int AS value FROM corpus.chunks')).toBe(1574)
  })

  it('grava uma versão do corpus, a cobertura e o run de ingestão', async () => {
    expect(await scalar<number>('SELECT max(id) AS value FROM corpus.corpus_versions')).toBe(1)
    expect(await scalar<number>('SELECT count(*)::int AS value FROM corpus.coverage')).toBe(6)
    expect(
      await scalar<number>(
        `SELECT count(*)::int AS value FROM corpus.ingestion_runs
         WHERE target = 'fixture' AND status <> 'succeeded'`,
      ),
    ).toBe(0)
    expect(
      await scalar<number>(
        'SELECT count(*)::int AS value FROM corpus.chunks WHERE embedding IS NULL OR corpus_version <> 1',
      ),
    ).toBe(0)
  })

  it('todo chunk publicável tem fonte publicada', async () => {
    const orphans = await scalar<number>(`SELECT count(*)::int AS value FROM corpus.chunks c
      WHERE upper_inf(c.knowledge) AND c.review_status IN ('auto', 'approved')
        AND NOT EXISTS (SELECT 1 FROM corpus.chunk_sources s
          JOIN corpus.document_versions dv ON dv.id = s.document_version_id
          WHERE s.chunk_id = c.id AND dv.status = 'published')`)
    expect(orphans).toBe(0)
  })

  it('não há redações publicáveis sobrepostas do mesmo dispositivo', async () => {
    const overlaps = await scalar<number>(`SELECT count(*)::int AS value
      FROM corpus.provision_versions a JOIN corpus.provision_versions b
        ON a.provision_id = b.provision_id AND a.id < b.id AND a.modality = b.modality
       AND a.valid_during && b.valid_during
      WHERE upper_inf(a.knowledge) AND upper_inf(b.knowledge)`)
    expect(overlaps).toBe(0)
  })

  it('gera o tsv sem acentos: "nao" casa com "não" e "secretario" com "Secretário"', async () => {
    const matches = await scalar<number>(`SELECT count(*)::int AS value FROM corpus.chunks
      WHERE tsv @@ to_tsquery('pg_catalog.portuguese', public.immutable_unaccent('secretario & nao'))`)
    expect(matches).toBeGreaterThan(0)
  })
})

describe('pv_no_overlap', () => {
  async function paragraph6(): Promise<string> {
    return scalar<string>(
      `SELECT id AS value FROM corpus.provisions WHERE stable_key = 'go:rcte:art:76:par:6'`,
    )
  }

  async function insertVersion(provisionId: string, reviewStatus: string, validDuring: string) {
    await owner.query(
      `INSERT INTO corpus.provision_versions (provision_id, display_label, valid_during, knowledge,
         validity_basis, review_status, text, content_hash)
       VALUES ($1, 'RCTE, art. 76, § 6º', $2, '[2026-11-10,)', 'legal_effect', $3, 'anomalia', 'x')`,
      [provisionId, validDuring, reviewStatus],
    )
  }

  it('recusa redação publicável sobreposta a outra do mesmo dispositivo', async () => {
    const id = await paragraph6()
    await owner.query('BEGIN')
    try {
      await expect(insertVersion(id, 'auto', '[2005-01-01,2006-01-01)')).rejects.toSatisfy(
        (error) => sqlState(error) === '23P01',
      )
    } finally {
      await owner.query('ROLLBACK')
    }
  })

  it('aceita uma anomalia pending sobreposta, que fica fora da busca de produção', async () => {
    const id = await paragraph6()
    await owner.query('BEGIN')
    try {
      await insertVersion(id, 'pending', '[2005-01-01,2006-01-01)')
      const versions = await scalar<number>(
        `SELECT count(*)::int AS value FROM corpus.provision_versions WHERE provision_id = $1`,
        [id],
      )
      expect(versions).toBe(4)
    } finally {
      await owner.query('ROLLBACK')
    }
  })

  it('recusa vigência sem limite inferior ou vazia', async () => {
    const id = await paragraph6()
    for (const validDuring of ['(,2000-01-01)', 'empty']) {
      await owner.query('BEGIN')
      try {
        await expect(insertVersion(id, 'rejected', validDuring)).rejects.toSatisfy(
          (error) => sqlState(error) === '23514',
        )
      } finally {
        await owner.query('ROLLBACK')
      }
    }
  })
})

describe('seed com replace', () => {
  it('esvazia o corpus (com cache e runs) e grava de novo, na corpus_version 1', async () => {
    const replaced = await seedFixtureCorpus(database.ownerUrl, { replace: true })
    expect(replaced).toMatchObject({ corpusVersion: 1, unchanged: 0, chunks: 1574 })
    expect(await scalar<number>('SELECT count(*)::int AS value FROM corpus.ingestion_runs')).toBe(1)
    expect(await scalar<number>('SELECT count(*)::int AS value FROM corpus.coverage')).toBe(6)
  })
})
