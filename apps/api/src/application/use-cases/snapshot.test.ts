import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { type BlobStore, BlobStoreName } from '../ports/blob-store.ts'
import {
  type MigrationRef,
  type PromoteRecord,
  SNAPSHOT_TABLES,
  type SnapshotCodec,
  type SnapshotRepository,
  type SnapshotRow,
  type SnapshotTable,
} from '../ports/snapshot-repository.ts'

/** Store em memória mínimo (o adapter de verdade fica em `adapters/out/fakes`). */
function createInMemoryBlobStore(): BlobStore & { keys(store: BlobStoreName): string[] } {
  const data = new Map<string, Uint8Array>()
  const id = (store: BlobStoreName, key: string) => `${store}\u0000${key}`
  const keys = (store: BlobStoreName) =>
    [...data.keys()]
      .filter((entry) => entry.startsWith(`${store}\u0000`))
      .map((entry) => entry.slice(store.length + 1))
      .sort()
  return {
    get: (store, key) => Promise.resolve(data.get(id(store, key)) ?? null),
    set: (store, key, value) => {
      data.set(id(store, key), typeof value === 'string' ? new TextEncoder().encode(value) : value)
      return Promise.resolve()
    },
    list: (store, prefix = '') =>
      Promise.resolve(keys(store).filter((key) => key.startsWith(prefix))),
    delete: (store, key) => {
      data.delete(id(store, key))
      return Promise.resolve()
    },
    keys,
  }
}

/** Codec de teste: JSON por linha, sem compressão. */
const snapshotCodec: SnapshotCodec = {
  async encode(batches) {
    const rows: SnapshotRow[] = []
    for await (const batch of batches) {
      rows.push(...batch)
    }
    const data = new TextEncoder().encode(rows.map((row) => JSON.stringify(row)).join('\n'))
    return { data, rows: rows.length, sha256: createHash('sha256').update(data).digest('hex') }
  },
  async *decode(data) {
    const text = new TextDecoder().decode(data)
    yield text === '' ? [] : text.split('\n').map((line): SnapshotRow => JSON.parse(line))
  },
  sha256: (data) => createHash('sha256').update(data).digest('hex'),
}

import {
  createExportSnapshot,
  SnapshotError,
  snapshotManifestKey,
  snapshotTableKey,
} from './export-snapshot.ts'
import { createPromoteSnapshot } from './promote-snapshot.ts'

const MIGRATION: MigrationRef = { hash: 'm1', name: '0004_ingestion-pipeline' }
const NOW = new Date('2026-11-10T15:00:00.000Z')

function repository(options: {
  readonly version?: number | null
  readonly migration?: MigrationRef | null
  readonly targetMigration?: MigrationRef | null
  readonly targetVersion?: number | null
  readonly rows?: Partial<Record<SnapshotTable, SnapshotRow[]>>
}) {
  const promoted: { record: PromoteRecord; rows: Record<string, SnapshotRow[]> }[] = []
  const repo: SnapshotRepository = {
    read: (work) =>
      work({
        corpusVersion: options.version === undefined ? 1 : options.version,
        migration: options.migration === undefined ? MIGRATION : options.migration,
        async *rows(table) {
          const rows = options.rows?.[table] ?? []
          if (rows.length > 0) {
            yield rows.slice(0, 1)
            yield rows.slice(1)
          }
        },
      }),
    latestMigration: () =>
      Promise.resolve(options.targetMigration === undefined ? MIGRATION : options.targetMigration),
    currentCorpusVersion: () =>
      Promise.resolve(options.targetVersion === undefined ? null : options.targetVersion),
    async promote(record) {
      const rows: Record<string, SnapshotRow[]> = {}
      for (const table of SNAPSHOT_TABLES) {
        rows[table] = []
        for await (const batch of record.rows(table)) {
          rows[table].push(...batch)
        }
      }
      promoted.push({ record, rows })
      return Object.fromEntries(
        SNAPSHOT_TABLES.map((table) => [table, rows[table]?.length ?? 0]),
      ) as Record<SnapshotTable, number>
    },
  }
  return { repo, promoted }
}

function deps(repo: SnapshotRepository, blobs = createInMemoryBlobStore()) {
  return { snapshots: repo, codec: snapshotCodec, blobs, clock: { now: () => new Date(NOW) } }
}

const ROWS = {
  documents: [
    { id: 'd1', slug: 'rcte' },
    { id: 'd2', slug: 'cte' },
  ],
  chunks: [{ id: 'c1', embedding: '[0.5,0.25]', ordinal: 0, structured: { a: [1, null] } }],
}

describe('chaves do snapshot', () => {
  it('seguem snapshots/<versão>/', () => {
    expect(snapshotTableKey(3, 'chunks')).toBe('snapshots/3/chunks.jsonl.zst')
    expect(snapshotManifestKey(3)).toBe('snapshots/3/manifest.json')
  })
})

describe('ExportSnapshot e PromoteSnapshot', () => {
  it('exporta, grava o manifesto por último e promove com as mesmas linhas', async () => {
    const blobs = createInMemoryBlobStore()
    const source = repository({ rows: ROWS })
    const exported = await createExportSnapshot(deps(source.repo, blobs))({})
    expect(exported.manifestKey).toBe('snapshots/1/manifest.json')
    expect(exported.manifest).toMatchObject({
      format: 1,
      corpusVersion: 1,
      createdAt: NOW.toISOString(),
      migration: MIGRATION,
    })
    expect(exported.manifest.tables.map((table) => [table.name, table.rows])).toEqual(
      SNAPSHOT_TABLES.map((table) => [
        table,
        table === 'documents' ? 2 : table === 'chunks' ? 1 : 0,
      ]),
    )

    const target = repository({ targetVersion: 1 })
    const promoted = await createPromoteSnapshot(deps(target.repo, blobs))({
      manifestKey: exported.manifestKey,
    })
    expect(promoted.corpusVersion).toBe(1)
    expect(promoted.rows.documents).toBe(2)
    expect(target.promoted[0]?.rows['documents']).toEqual(ROWS.documents)
    expect(target.promoted[0]?.rows['chunks']).toEqual(ROWS.chunks)
    expect(target.promoted[0]?.record.today).toBe('2026-11-10')
  })

  it('recusa exportar sem versão, sem migração ou com a versão errada', async () => {
    await expect(
      createExportSnapshot(deps(repository({ version: null }).repo))({}),
    ).rejects.toThrow(/sem versão/)
    await expect(
      createExportSnapshot(deps(repository({ migration: null }).repo))({}),
    ).rejects.toThrow(/migrações/)
    await expect(
      createExportSnapshot(deps(repository({ version: 2 }).repo))({ corpusVersion: 1 }),
    ).rejects.toBeInstanceOf(SnapshotError)
  })

  it('mantém só os 3 snapshots mais recentes no store', async () => {
    const blobs = createInMemoryBlobStore()
    await blobs.set(BlobStoreName.CorpusSnapshots, 'outro/arquivo.txt', 'fica')
    for (const version of [1, 2, 3, 4, 10]) {
      await createExportSnapshot(deps(repository({ version }).repo, blobs))({
        corpusVersion: version,
      })
    }
    const versions = new Set(
      blobs
        .keys(BlobStoreName.CorpusSnapshots)
        .filter((key) => key.startsWith('snapshots/'))
        .map((key) => key.split('/')[1]),
    )
    expect([...versions].sort()).toEqual(['10', '3', '4'])
    expect(await blobs.get(BlobStoreName.CorpusSnapshots, 'outro/arquivo.txt')).not.toBeNull()
  })
})

describe('validações da promoção', () => {
  async function exported() {
    const blobs = createInMemoryBlobStore()
    const result = await createExportSnapshot(
      deps(repository({ rows: ROWS, version: 5 }).repo, blobs),
    )({})
    return { blobs, manifestKey: result.manifestKey, manifest: result.manifest }
  }

  it('manifesto ausente, ilegível ou inválido', async () => {
    const blobs = createInMemoryBlobStore()
    const promote = createPromoteSnapshot(deps(repository({}).repo, blobs))
    await expect(promote({ manifestKey: 'snapshots/9/manifest.json' })).rejects.toThrow(
      /não existe/,
    )
    await blobs.set(BlobStoreName.CorpusSnapshots, 'x.json', '{nao json')
    await expect(promote({ manifestKey: 'x.json' })).rejects.toThrow(/não é JSON/)
    await blobs.set(BlobStoreName.CorpusSnapshots, 'y.json', JSON.stringify({ format: 1 }))
    await expect(promote({ manifestKey: 'y.json' })).rejects.toThrow(/inválido/)
  })

  it('exige a mesma migração e um destino que não esteja à frente', async () => {
    const { blobs, manifestKey } = await exported()
    const promoteWith = (options: Parameters<typeof repository>[0]) =>
      createPromoteSnapshot(deps(repository(options).repo, blobs))({ manifestKey })
    await expect(promoteWith({ targetMigration: null })).rejects.toThrow(/nenhuma/)
    await expect(promoteWith({ targetMigration: { hash: 'outra', name: '0005' } })).rejects.toThrow(
      /0005/,
    )
    await expect(promoteWith({ targetVersion: 6 })).rejects.toThrow(/mais nova/)
    expect((await promoteWith({ targetVersion: 5 })).corpusVersion).toBe(5)
  })

  it('confere a presença, o tamanho e o sha256 de cada arquivo', async () => {
    const { blobs, manifestKey, manifest } = await exported()
    const chunks = manifest.tables.find((table) => table.name === 'chunks')?.key ?? ''
    const promote = createPromoteSnapshot(deps(repository({}).repo, blobs))
    const original = (await blobs.get(BlobStoreName.CorpusSnapshots, chunks)) ?? new Uint8Array()
    const flipped = new Uint8Array(original)
    flipped[0] = (flipped[0] ?? 0) ^ 1
    await blobs.set(BlobStoreName.CorpusSnapshots, chunks, flipped)
    await expect(promote({ manifestKey })).rejects.toThrow(/sha256/)
    await blobs.set(BlobStoreName.CorpusSnapshots, chunks, new Uint8Array([...original, 0]))
    await expect(promote({ manifestKey })).rejects.toThrow(/sha256/)
    await blobs.delete(BlobStoreName.CorpusSnapshots, chunks)
    await expect(promote({ manifestKey })).rejects.toThrow(/ausente/)
  })
})
