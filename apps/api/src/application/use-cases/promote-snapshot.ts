import { isoDateInTimeZone } from '@teko/shared/vigencia'
import { BlobStoreName } from '../ports/blob-store.ts'
import {
  type SnapshotManifest,
  type SnapshotTable,
  snapshotManifestSchema,
} from '../ports/snapshot-repository.ts'
import { type SnapshotDeps, SnapshotError } from './export-snapshot.ts'

/**
 * `PromoteSnapshot` (job `promote-corpus`, environment `production`): aplica um snapshot exportado
 * do staging sem ler o banco de staging e sem recalcular embeddings (0 neurons).
 *
 * Antes de escrever: o manifesto é validado, o hash da última migração aplicada no destino precisa
 * ser igual ao do manifesto (por isso roda depois da fase `migrate` do deploy), a versão do corpus
 * no destino não pode ser mais nova que a do snapshot, e o sha256 de cada arquivo é conferido.
 * A escrita é uma transação (`SnapshotRepository.promote`): upsert por chave natural, fechamento do
 * `knowledge` das linhas ausentes, `coverage` com o `verified_at` mais recente dos dois e as
 * lacunas do snapshot mais as do destino detectadas depois da exportação (A1), e `corpus_versions`
 * por último.
 */

interface PromoteSnapshotCommand {
  readonly manifestKey: string
}

export type PromoteSnapshot = (command: PromoteSnapshotCommand) => Promise<{
  readonly corpusVersion: number
  readonly rows: Readonly<Record<SnapshotTable, number>>
}>

function parseManifest(raw: Uint8Array, key: string): SnapshotManifest {
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch (error) {
    throw new SnapshotError(`manifesto ${key} não é JSON: ${String(error)}`)
  }
  const parsed = snapshotManifestSchema.safeParse(json)
  if (!parsed.success) {
    throw new SnapshotError(`manifesto ${key} inválido: ${parsed.error.message}`)
  }
  return parsed.data
}

export function createPromoteSnapshot(deps: SnapshotDeps): PromoteSnapshot {
  return async ({ manifestKey }) => {
    const raw = await deps.blobs.get(BlobStoreName.CorpusSnapshots, manifestKey)
    if (raw === null) {
      throw new SnapshotError(`manifesto ${manifestKey} não existe no store corpus-snapshots`)
    }
    const manifest = parseManifest(raw, manifestKey)

    const migration = await deps.snapshots.latestMigration()
    if (migration?.hash !== manifest.migration.hash) {
      throw new SnapshotError(
        `migração do destino (${migration?.name ?? 'nenhuma'}) diferente da do snapshot ` +
          `(${manifest.migration.name ?? manifest.migration.hash}): rode as migrações antes`,
      )
    }
    const current = await deps.snapshots.currentCorpusVersion()
    if (current !== null && current > manifest.corpusVersion) {
      throw new SnapshotError(
        `o destino já está na versão ${String(current)}, mais nova que o snapshot ${String(manifest.corpusVersion)}`,
      )
    }

    const files = new Map<SnapshotTable, Uint8Array>()
    for (const table of manifest.tables) {
      const data = await deps.blobs.get(BlobStoreName.CorpusSnapshots, table.key)
      if (data === null) {
        throw new SnapshotError(`arquivo ${table.key} ausente do store corpus-snapshots`)
      }
      if (data.byteLength !== table.bytes || deps.codec.sha256(data) !== table.sha256) {
        throw new SnapshotError(`sha256 de ${table.key} não confere com o manifesto`)
      }
      files.set(table.name, data)
    }

    const rows = await deps.snapshots.promote({
      manifest,
      today: isoDateInTimeZone(deps.clock.now()),
      rows: (table) => deps.codec.decode(files.get(table) ?? new Uint8Array()),
    })
    return { corpusVersion: manifest.corpusVersion, rows }
  }
}
