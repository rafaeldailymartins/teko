import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Privilégio mínimo (DoD da F2): o runtime (`teko_app`) tem os timeouts no role, lê o corpus, escreve
 * em `app` e não executa DDL; o `teko_watch` só atualiza `verified_at`, `gaps` e `gap_reason` da
 * cobertura. Os grants vêm da migração custom e valem também para tabelas criadas depois pelo owner
 * (ALTER DEFAULT PRIVILEGES).
 */

let database: TestDatabase

async function withClient<T>(url: string, run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

function sqlState(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error ? String(error.code) : undefined
}

beforeAll(async () => {
  database = await createTestDatabase()
  await withClient(database.ownerUrl, (client) =>
    client.query(`INSERT INTO corpus.coverage (family, jurisdiction, covered, verified_at, corpus_version)
      VALUES ('rcte', 'GO', '{[1997-12-01,)}', '2026-11-01', 1)`),
  )
})

afterAll(async () => {
  await database.drop()
})

describe('teko_app', () => {
  it('herda statement_timeout e idle_in_transaction_session_timeout de 5 s do role', async () => {
    const result = await withClient(database.appUrl, async (client) => {
      const statement = await client.query<{ statement_timeout: string }>('SHOW statement_timeout')
      const idle = await client.query<{ idle_in_transaction_session_timeout: string }>(
        'SHOW idle_in_transaction_session_timeout',
      )
      return [
        statement.rows[0]?.statement_timeout,
        idle.rows[0]?.idle_in_transaction_session_timeout,
      ]
    })
    expect(result).toEqual(['5s', '5s'])
  })

  it('recebe permission denied em DDL', async () => {
    await withClient(database.appUrl, async (client) => {
      await expect(client.query('DROP TABLE corpus.chunks')).rejects.toSatisfy(
        (error) => sqlState(error) === '42501',
      )
      await expect(client.query('CREATE TABLE app.x (id int)')).rejects.toSatisfy(
        (error) => sqlState(error) === '42501',
      )
      await expect(client.query('ALTER TABLE app.questions ADD COLUMN x int')).rejects.toSatisfy(
        (error) => sqlState(error) === '42501',
      )
    })
  })

  it('lê o corpus, mas não escreve nele', async () => {
    await withClient(database.appUrl, async (client) => {
      const rows = await client.query('SELECT family FROM corpus.coverage')
      expect(rows.rowCount).toBe(1)
      await expect(
        client.query(`UPDATE corpus.coverage SET verified_at = '2026-11-10'`),
      ).rejects.toSatisfy((error) => sqlState(error) === '42501')
    })
  })

  it('escreve no schema app, inclusive em tabelas criadas depois pelo owner', async () => {
    await withClient(database.ownerUrl, (client) =>
      client.query('CREATE TABLE app.later_table (id int PRIMARY KEY)'),
    )
    await withClient(database.appUrl, async (client) => {
      await client.query(
        `INSERT INTO app.usage_daily (day, scope, requests) VALUES ('2026-11-10', 'global', 1)`,
      )
      await client.query('INSERT INTO app.later_table (id) VALUES (1)')
      const rows = await client.query('SELECT requests FROM app.usage_daily')
      expect(rows.rows).toEqual([{ requests: 1 }])
    })
  })

  it('cai no statement_timeout acima de 5 s', async () => {
    await withClient(database.appUrl, async (client) => {
      await expect(client.query('SELECT pg_sleep(6)')).rejects.toSatisfy(
        (error) => sqlState(error) === '57014',
      )
    })
  }, 15_000)
})

describe('teko_watch', () => {
  it('atualiza só verified_at, gaps e gap_reason da cobertura', async () => {
    await withClient(database.watchUrl, async (client) => {
      const updated = await client.query(
        `UPDATE corpus.coverage SET verified_at = '2026-11-10', gaps = '{[2026-11-05,)}',
           gap_reason = 'mudança detectada' WHERE verified_at < '2026-11-10'`,
      )
      expect(updated.rowCount).toBe(1)
      await expect(
        client.query(`UPDATE corpus.coverage SET covered = '{[2000-01-01,)}'`),
      ).rejects.toSatisfy((error) => sqlState(error) === '42501')
      await expect(client.query('SELECT 1 FROM corpus.chunks')).rejects.toSatisfy(
        (error) => sqlState(error) === '42501',
      )
      await expect(client.query('SELECT 1 FROM app.questions')).rejects.toSatisfy(
        (error) => sqlState(error) === '42501',
      )
    })
  })
})
