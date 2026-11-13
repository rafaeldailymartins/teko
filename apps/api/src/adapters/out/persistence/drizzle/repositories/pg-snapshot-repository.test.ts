import type pg from 'pg'
import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_TABLES,
  type SnapshotManifest,
  type SnapshotRow,
} from '#app/ports/snapshot-repository.ts'
import { createPgSnapshotRepository } from './pg-snapshot-repository.ts'

/**
 * `pg.Pool` falso: grava as instruções e responde às leituras do repositório (migração, versão,
 * cursores, órfãos). O caminho real é coberto por `test/integration/ingest/snapshot.test.ts`.
 */
function fakePool(
  options: {
    readonly migrationError?: { code: string }
    readonly migration?: { hash: string; name: string | null } | null
    readonly orphans?: number
    readonly failOn?: RegExp
  } = {},
) {
  const statements: { text: string; values: unknown[] }[] = []
  let released = 0
  const fetched = new Set<string>()
  const client = {
    query(text: string, values: unknown[] = []) {
      statements.push({ text, values })
      if (options.failOn?.test(text) === true) {
        return Promise.reject(new Error('falha simulada'))
      }
      if (text.includes('drizzle.__drizzle_migrations')) {
        if (options.migrationError !== undefined) {
          return Promise.reject(
            Object.assign(new Error('relação não existe'), options.migrationError),
          )
        }
        const migration =
          options.migration === undefined ? { hash: 'h', name: 'm' } : options.migration
        return Promise.resolve({ rows: migration === null ? [] : [migration] })
      }
      if (text.includes('max(id) AS id')) {
        return Promise.resolve({ rows: [{ id: 3 }] })
      }
      const fetch = /^FETCH \d+ FROM (\S+)/.exec(text)
      if (fetch?.[1] !== undefined) {
        const first = !fetched.has(fetch[1])
        fetched.add(fetch[1])
        return Promise.resolve({ rows: first ? [{ id: fetch[1] }] : [] })
      }
      if (text.includes('AS orphans')) {
        return Promise.resolve({ rows: [{ orphans: options.orphans ?? 0 }] })
      }
      return Promise.resolve({ rows: [] })
    },
    release() {
      released += 1
    },
  }
  const pool = { connect: () => Promise.resolve(client) } as unknown as pg.Pool
  return { pool, statements, released: () => released }
}

const manifest = (rows: number): SnapshotManifest => ({
  format: 1,
  corpusVersion: 3,
  createdAt: '2026-11-10T15:00:00.000Z',
  migration: { hash: 'h', name: 'm' },
  tables: SNAPSHOT_TABLES.map((name) => ({
    name,
    key: `${name}.jsonl.zst`,
    rows,
    bytes: 1,
    sha256: 'a'.repeat(64),
  })),
})

async function* one(row: SnapshotRow): AsyncGenerator<SnapshotRow[]> {
  yield [row]
}

describe('PgSnapshotRepository', () => {
  it('lê todas as tabelas por cursor numa transação REPEATABLE READ', async () => {
    const { pool, statements, released } = fakePool()
    const repo = createPgSnapshotRepository(pool)
    const read = await repo.read(async (reader) => {
      const out: Record<string, SnapshotRow[]> = {}
      for (const table of SNAPSHOT_TABLES) {
        out[table] = []
        for await (const batch of reader.rows(table)) {
          out[table].push(...batch)
        }
      }
      return { version: reader.corpusVersion, migration: reader.migration, out }
    })
    expect(read.version).toBe(3)
    expect(read.migration).toEqual({ hash: 'h', name: 'm' })
    expect(read.out['chunks']).toEqual([{ id: 'snap_cursor_chunks' }])
    const all = statements.map((statement) => statement.text)
    expect(all[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    expect(all.at(-1)).toBe('COMMIT')
    expect(all.find((text) => text.startsWith('DECLARE snap_cursor_chunks'))).toMatch(
      /CASE WHEN upper_inf\(t\.knowledge\) THEN t\.embedding::text END AS embedding/,
    )
    expect(released()).toBe(1)
  })

  it('migração e versão atuais; sem tabela de migrações, null', async () => {
    expect(await createPgSnapshotRepository(fakePool().pool).latestMigration()).toEqual({
      hash: 'h',
      name: 'm',
    })
    expect(
      await createPgSnapshotRepository(fakePool({ migration: null }).pool).latestMigration(),
    ).toBeNull()
    expect(
      await createPgSnapshotRepository(
        fakePool({ migrationError: { code: '42P01' } }).pool,
      ).latestMigration(),
    ).toBeNull()
    await expect(
      createPgSnapshotRepository(
        fakePool({ migrationError: { code: '28000' } }).pool,
      ).latestMigration(),
    ).rejects.toThrow()
    expect(await createPgSnapshotRepository(fakePool().pool).currentCorpusVersion()).toBe(3)
  })

  it('promove: tabelas temporárias, mescla na ordem e confere as contagens', async () => {
    const { pool, statements } = fakePool()
    const counts = await createPgSnapshotRepository(pool).promote({
      manifest: manifest(1),
      today: '2026-11-10',
      rows: (table) => one({ id: table }),
    })
    expect(counts.chunks).toBe(1)
    const all = statements.map((statement) => statement.text)
    expect(all[0]).toBe('BEGIN')
    expect(all.at(-1)).toBe('COMMIT')
    expect(all.filter((text) => text.startsWith('CREATE TEMP TABLE snap_'))).toHaveLength(
      SNAPSHOT_TABLES.length,
    )
    const closing = statements.find((statement) =>
      statement.text.includes('NOT IN (SELECT id FROM snap_provision_versions)'),
    )
    expect(closing?.values).toEqual(['2026-11-10'])
    expect(
      all.findIndex((text) => text.includes('INSERT INTO corpus.corpus_versions')),
    ).toBeGreaterThan(all.findIndex((text) => text.includes('INSERT INTO corpus.coverage')))
  })

  it('contagem diferente do manifesto ou órfãos desfazem a promoção', async () => {
    const wrong = fakePool()
    await expect(
      createPgSnapshotRepository(wrong.pool).promote({
        manifest: manifest(2),
        today: '2026-11-10',
        rows: (t) => one({ id: t }),
      }),
    ).rejects.toThrow(/manifesto/)
    expect(wrong.statements.at(-1)?.text).toBe('ROLLBACK')
    const orphans = fakePool({ orphans: 1 })
    await expect(
      createPgSnapshotRepository(orphans.pool).promote({
        manifest: manifest(1),
        today: '2026-11-10',
        rows: (t) => one({ id: t }),
      }),
    ).rejects.toThrow(/sem fonte/)
    const failing = fakePool({ failOn: /^FETCH/ })
    await expect(
      createPgSnapshotRepository(failing.pool).read(async (reader) => {
        for await (const _ of reader.rows('documents')) {
          // consome
        }
      }),
    ).rejects.toThrow('falha simulada')
  })
})
