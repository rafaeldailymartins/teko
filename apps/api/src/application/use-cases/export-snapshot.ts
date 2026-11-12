import { type BlobStore, BlobStoreName } from '../ports/blob-store.ts'
import type { Clock } from '../ports/clock.ts'
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_TABLES,
  type SnapshotCodec,
  type SnapshotManifest,
  type SnapshotRepository,
} from '../ports/snapshot-repository.ts'

/**
 * `ExportSnapshot` (staging, depois do `RefreshCoverage`): lê o schema `corpus` numa transação
 * consistente e grava `snapshots/<corpusVersion>/<tabela>.jsonl.zst` no store `corpus-snapshots`,
 * na ordem de FK, e por último o `manifest.json` (contagens, sha256 de cada arquivo e o hash da
 * última migração aplicada). Um manifesto só existe se todos os arquivos dele foram gravados.
 * Depois apaga os snapshots além dos 3 mais recentes.
 */

const SNAPSHOT_PREFIX = 'snapshots/'
const SNAPSHOT_RETENTION = 3

export function snapshotTableKey(corpusVersion: number, table: string): string {
  return `${SNAPSHOT_PREFIX}${String(corpusVersion)}/${table}.jsonl.zst`
}

export function snapshotManifestKey(corpusVersion: number): string {
  return `${SNAPSHOT_PREFIX}${String(corpusVersion)}/manifest.json`
}

interface ExportSnapshotCommand {
  /** Se informado, precisa ser a versão atual do corpus (não há exportação de versão antiga). */
  readonly corpusVersion?: number
}

export type ExportSnapshot = (command: ExportSnapshotCommand) => Promise<{
  readonly manifestKey: string
  readonly manifest: SnapshotManifest
}>

export interface SnapshotDeps {
  readonly snapshots: SnapshotRepository
  readonly codec: SnapshotCodec
  readonly blobs: BlobStore
  readonly clock: Clock
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SnapshotError'
  }
}

/** Versões com algum arquivo no store, da mais nova para a mais antiga. */
function versionsIn(keys: readonly string[]): number[] {
  const versions = new Set<number>()
  for (const key of keys) {
    const match = /^snapshots\/(\d+)\//.exec(key)
    if (match?.[1] !== undefined) {
      versions.add(Number(match[1]))
    }
  }
  return [...versions].sort((a, b) => b - a)
}

async function pruneSnapshots(blobs: BlobStore, retain: number): Promise<void> {
  const keys = await blobs.list(BlobStoreName.CorpusSnapshots, SNAPSHOT_PREFIX)
  const expired = new Set(versionsIn(keys).slice(retain))
  for (const key of keys) {
    const match = /^snapshots\/(\d+)\//.exec(key)
    if (match?.[1] !== undefined && expired.has(Number(match[1]))) {
      await blobs.delete(BlobStoreName.CorpusSnapshots, key)
    }
  }
}

export function createExportSnapshot(deps: SnapshotDeps): ExportSnapshot {
  return async (command) => {
    const result = await deps.snapshots.read(async (reader) => {
      const corpusVersion = reader.corpusVersion
      if (corpusVersion === null) {
        throw new SnapshotError('corpus sem versão: nada a exportar')
      }
      if (command.corpusVersion !== undefined && command.corpusVersion !== corpusVersion) {
        throw new SnapshotError(
          `a versão atual do corpus é ${String(corpusVersion)}, não ${String(command.corpusVersion)}`,
        )
      }
      if (reader.migration === null) {
        throw new SnapshotError('banco sem migrações aplicadas')
      }
      const tables: SnapshotManifest['tables'][number][] = []
      for (const table of SNAPSHOT_TABLES) {
        const encoded = await deps.codec.encode(reader.rows(table))
        const key = snapshotTableKey(corpusVersion, table)
        await deps.blobs.set(BlobStoreName.CorpusSnapshots, key, encoded.data)
        tables.push({
          name: table,
          key,
          rows: encoded.rows,
          bytes: encoded.data.byteLength,
          sha256: encoded.sha256,
        })
      }
      const manifest: SnapshotManifest = {
        format: SNAPSHOT_FORMAT,
        corpusVersion,
        createdAt: deps.clock.now().toISOString(),
        migration: { hash: reader.migration.hash, name: reader.migration.name },
        tables,
      }
      const manifestKey = snapshotManifestKey(corpusVersion)
      await deps.blobs.set(
        BlobStoreName.CorpusSnapshots,
        manifestKey,
        `${JSON.stringify(manifest, null, 2)}\n`,
      )
      return { manifestKey, manifest }
    })
    await pruneSnapshots(deps.blobs, SNAPSHOT_RETENTION)
    return result
  }
}
