import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { createPgCoverageWatchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-coverage-watch-repository.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * `mark-coverage` contra o Postgres real, com o role `teko_watch` (DoD da F3: "`verified_at` avança
 * diariamente sem mudança nas fontes"):
 * - sem mudança, exatamente um `UPDATE corpus.coverage SET verified_at = $1 WHERE verified_at < $1`;
 * - com mudança, a lacuna `[effectiveFrom, ∞)` entra em `gaps` e o motivo em `gap_reason`;
 * - o role só lê `corpus.coverage` e só atualiza `verified_at`, `gaps` e `gap_reason` (grants da
 *   migração custom), e o repositório funciona com esse privilégio mínimo.
 */

let database: TestDatabase
let owner: pg.Client
let watch: Database

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

interface CoverageRow {
  family: string
  verified_at: string
  gaps: string
  gap_reason: string | null
  covered: string
}

async function rows(): Promise<CoverageRow[]> {
  const result = await owner.query<CoverageRow>(
    `SELECT family, verified_at::text, gaps::text, gap_reason, covered::text
       FROM corpus.coverage ORDER BY family`,
  )
  return result.rows
}

beforeAll(async () => {
  database = await createTestDatabase()
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
  watch = createDatabase({ url: database.watchUrl, applicationName: 'teko-watch-test' })
}, 120_000)

afterAll(async () => {
  await watch?.close()
  await owner?.end()
  await database?.drop()
})

beforeEach(async () => {
  await owner.query('DELETE FROM corpus.coverage')
  await owner.query(`INSERT INTO corpus.coverage (family, jurisdiction, covered, verified_at, corpus_version, gaps, gap_reason)
    VALUES
      ('rcte', 'GO', '{[1997-12-01,)}', '2026-11-09', 1, '{}', NULL),
      ('cte', 'GO', '{[1991-12-01,)}', '2026-11-11', 1, '{}', NULL),
      ('efd-icms-ipi', 'BR', '{[2009-01-01,)}', '2026-11-10', 1, '{[2026-12-01,2027-01-01)}', 'antiga'),
      ('tabelas-go', 'GO', '{[2009-01-01,)}', '2026-11-01', 1, '{}', NULL)`)
})

describe('createPgCoverageWatchRepository (role teko_watch)', () => {
  it('sem mudança, executa um único UPDATE e só avança quem está atrás', async () => {
    const statements: string[] = []
    const query = watch.pool.query.bind(watch.pool)
    watch.pool.query = ((...args: Parameters<typeof query>) => {
      const [text] = args
      statements.push(typeof text === 'string' ? text : String((text as { text?: string }).text))
      return query(...args)
    }) as typeof query
    try {
      const repository = createPgCoverageWatchRepository(watch.db)
      const result = await repository.markVerified({
        verifiedAt: '2026-11-11',
        excludeFamilies: [],
        gaps: [],
      })
      expect(result).toEqual({ verifiedRows: 3, gapRows: 0 })
    } finally {
      watch.pool.query = query
    }
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(
      /^update "corpus"\."coverage" set "verified_at" = \$1 where "corpus"\."coverage"\."verified_at" < \$2$/u,
    )
    expect((await rows()).map((row) => [row.family, row.verified_at, row.gaps])).toEqual([
      ['cte', '2026-11-11', '{}'],
      ['efd-icms-ipi', '2026-11-11', '{[2026-12-01,2027-01-01)}'],
      ['rcte', '2026-11-11', '{}'],
      ['tabelas-go', '2026-11-11', '{}'],
    ])

    // Rodar de novo no mesmo dia não muda nada.
    const again = await createPgCoverageWatchRepository(watch.db).markVerified({
      verifiedAt: '2026-11-11',
      excludeFamilies: [],
      gaps: [],
    })
    expect(again.verifiedRows).toBe(0)
  })

  it('com mudança, acrescenta a lacuna e o motivo, e pula as famílias não verificadas', async () => {
    const repository = createPgCoverageWatchRepository(watch.db)
    const result = await repository.markVerified({
      verifiedAt: '2026-11-11',
      excludeFamilies: ['tabelas-go'],
      gaps: [
        { family: 'rcte', from: '2026-11-10', reason: 'Decreto nº 10.995 (desde 2026-11-10)' },
        { family: 'efd-icms-ipi', from: '2026-11-11', reason: 'Guia 3.2.5' },
        { family: 'rcte-anexos', from: '2026-11-11', reason: 'sem linha de cobertura' },
      ],
    })
    expect(result).toEqual({ verifiedRows: 2, gapRows: 2 })
    expect(await rows()).toEqual([
      {
        family: 'cte',
        verified_at: '2026-11-11',
        gaps: '{}',
        gap_reason: null,
        covered: '{[1991-12-01,)}',
      },
      {
        family: 'efd-icms-ipi',
        verified_at: '2026-11-11',
        gaps: '{[2026-11-11,)}',
        gap_reason: 'Guia 3.2.5',
        covered: '{[2009-01-01,)}',
      },
      {
        family: 'rcte',
        verified_at: '2026-11-11',
        gaps: '{[2026-11-10,)}',
        gap_reason: 'Decreto nº 10.995 (desde 2026-11-10)',
        covered: '{[1997-12-01,)}',
      },
      {
        family: 'tabelas-go',
        verified_at: '2026-11-01',
        gaps: '{}',
        gap_reason: null,
        covered: '{[2009-01-01,)}',
      },
    ])
  })
})

describe('grants do teko_watch', () => {
  it('tem só SELECT na tabela e UPDATE em verified_at, gaps e gap_reason', async () => {
    const tables = await owner.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_schema || '.' || table_name AS table_name, privilege_type
         FROM information_schema.role_table_grants WHERE grantee = 'teko_watch' ORDER BY 1, 2`,
    )
    expect(tables.rows).toEqual([{ table_name: 'corpus.coverage', privilege_type: 'SELECT' }])
    const columns = await owner.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
         WHERE grantee = 'teko_watch' AND privilege_type = 'UPDATE' ORDER BY 1`,
    )
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'gap_reason',
      'gaps',
      'verified_at',
    ])
  })

  it('recebe permission denied fora do que o mark-coverage precisa', async () => {
    const client = new pg.Client({ connectionString: database.watchUrl })
    await client.connect()
    try {
      for (const statement of [
        `UPDATE corpus.coverage SET covered = '{[2000-01-01,)}'`,
        'UPDATE corpus.coverage SET corpus_version = 2',
        `INSERT INTO corpus.coverage (family, jurisdiction, covered, verified_at, corpus_version)
           VALUES ('x', 'GO', '{}', '2026-11-11', 1)`,
        'DELETE FROM corpus.coverage',
        'SELECT 1 FROM corpus.documents',
        'SELECT 1 FROM corpus.corpus_versions',
        'SELECT 1 FROM app.questions',
        'CREATE TABLE corpus.x (id int)',
      ]) {
        await expect(client.query(statement), statement).rejects.toSatisfy(
          (error) => sqlState(error) === '42501',
        )
      }
    } finally {
      await client.end()
    }
  })
})
