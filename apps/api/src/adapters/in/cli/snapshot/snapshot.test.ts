import { describe, expect, it } from 'vitest'
import { SNAPSHOT_TABLES, type SnapshotManifest } from '#app/ports/snapshot-repository.ts'
import {
  EXIT_USAGE,
  runSnapshotExport,
  runSnapshotPromote,
  type SnapshotCliDeps,
  SnapshotUsageError,
} from './snapshot.ts'

const manifest: SnapshotManifest = {
  format: 1,
  corpusVersion: 4,
  createdAt: '2026-11-10T15:00:00.000Z',
  migration: { hash: 'h', name: 'm' },
  tables: SNAPSHOT_TABLES.map((name) => ({
    name,
    key: `snapshots/4/${name}.jsonl.zst`,
    rows: name === 'chunks' ? 10 : 1,
    bytes: 1,
    sha256: 'a'.repeat(64),
  })),
}

function deps() {
  const printed: string[] = []
  const exportCalls: unknown[] = []
  const promoteCalls: unknown[] = []
  const value: SnapshotCliDeps = {
    exportSnapshot: (command) => {
      exportCalls.push(command)
      return Promise.resolve({ manifestKey: 'snapshots/4/manifest.json', manifest })
    },
    promoteSnapshot: (command) => {
      promoteCalls.push(command)
      return Promise.resolve({
        corpusVersion: 4,
        rows: Object.fromEntries(SNAPSHOT_TABLES.map((name) => [name, 1])) as Record<
          (typeof SNAPSHOT_TABLES)[number],
          number
        >,
      })
    },
    print: (line) => printed.push(line),
  }
  return { value, printed, exportCalls, promoteCalls }
}

describe('cli snapshot export', () => {
  it('exporta a versão atual (ou a pedida) e imprime uma linha JSON', async () => {
    const d = deps()
    await runSnapshotExport(d.value, [])
    await runSnapshotExport(d.value, ['--corpus-version', '4'])
    expect(d.exportCalls).toEqual([{}, { corpusVersion: 4 }])
    expect(JSON.parse(d.printed[0] ?? '{}')).toMatchObject({
      manifestKey: 'snapshots/4/manifest.json',
      corpusVersion: 4,
      rows: { chunks: 10, documents: 1 },
    })
  })

  it('erros de uso saem com 64', async () => {
    const d = deps()
    await expect(runSnapshotExport(d.value, ['--corpus-version', '0'])).rejects.toMatchObject({
      exitCode: EXIT_USAGE,
    })
    await expect(runSnapshotExport(d.value, ['--manifest', 'x'])).rejects.toBeInstanceOf(
      SnapshotUsageError,
    )
  })
})

describe('cli snapshot promote', () => {
  it('aceita a chave do manifesto ou a versão', async () => {
    const d = deps()
    await runSnapshotPromote(d.value, ['--manifest', 'snapshots/4/manifest.json'])
    await runSnapshotPromote(d.value, ['--corpus-version', '4'])
    expect(d.promoteCalls).toEqual([
      { manifestKey: 'snapshots/4/manifest.json' },
      { manifestKey: 'snapshots/4/manifest.json' },
    ])
    expect(JSON.parse(d.printed[1] ?? '{}')).toMatchObject({ corpusVersion: 4 })
  })

  it('exige exatamente um dos dois', async () => {
    const d = deps()
    await expect(runSnapshotPromote(d.value, [])).rejects.toBeInstanceOf(SnapshotUsageError)
    await expect(
      runSnapshotPromote(d.value, ['--manifest', 'a', '--corpus-version', '1']),
    ).rejects.toThrow(/um dos dois/)
  })
})
