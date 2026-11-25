import { isoDateInTimeZone } from '@teko/shared/vigencia'
import { BlobStoreName } from '../ports/blob-store.ts'
import type { SnapshotManifest, SnapshotTable } from '../ports/snapshot-repository.ts'
import { parseManifest, type SnapshotDeps, SnapshotError } from './export-snapshot.ts'

/**
 * `PromoteSnapshot` (produção, depois da fase `migrate` do deploy; também o rollback manual): aplica
 * um snapshot exportado do staging sem ler o banco de staging e sem recalcular embeddings (0
 * neurons).
 *
 * Antes de escrever: o manifesto é validado, o hash da última migração aplicada no destino precisa
 * ser igual ao do manifesto (por isso roda depois da fase `migrate` do deploy), a versão do corpus
 * no destino não pode ser mais nova que a do snapshot, e o sha256 de cada arquivo é conferido.
 * Com `rollback`, o snapshot precisa ser mais antigo que o destino, a migração dele só precisa já ter
 * sido aplicada no destino, e ele entra como uma `corpus_version` nova.
 * A escrita é uma transação (`SnapshotRepository.promote`): upsert por chave natural, fechamento do
 * `knowledge` das linhas ausentes, `coverage` com o `verified_at` mais recente dos dois e as
 * lacunas do snapshot mais as do destino detectadas depois da exportação (A1), e `corpus_versions`
 * por último.
 *
 * `PromoteLockedSnapshot` (passo `promote-corpus` do job `deploy` da produção) é a porta do deploy:
 * promove o snapshot do `corpus.lock.json`, conferido pelo sha256 do manifesto, e não faz nada
 * quando a produção já está nele ou à frente dele.
 */

interface PromoteSnapshotCommand {
  readonly manifestKey: string
  /**
   * Rollback de corpus: repromove explicitamente um snapshot mais antigo que o destino, como uma
   * `corpus_version` nova. A migração do snapshot precisa já ter sido aplicada no destino (o formato
   * lê snapshots anteriores às colunas novas). Runbook: `docs/runbooks/rollback-corpus.md`.
   */
  readonly rollback?: boolean
}

interface PromoteSnapshotResult {
  readonly corpusVersion: number
  readonly rows: Readonly<Record<SnapshotTable, number>>
}

export type PromoteSnapshot = (command: PromoteSnapshotCommand) => Promise<PromoteSnapshotResult>

/** O snapshot do `corpus/corpus.lock.json` (os campos de `snapshot` que a promoção confere). */
interface LockedSnapshot {
  readonly manifestKey: string
  readonly corpusVersion: number
  /** sha256 do `manifest.json` como gravado no store `corpus-snapshots`. */
  readonly manifestSha256: string
}

type PromoteLockedSnapshotResult =
  | ({ readonly status: 'promoted' } & PromoteSnapshotResult)
  | {
      /** `up-to-date`: o destino já está na versão do lock; `target-newer`: está à frente dela. */
      readonly status: 'up-to-date' | 'target-newer'
      /** Versão do snapshot do lock. */
      readonly corpusVersion: number
      /** Versão atual do destino (`max(corpus_versions.id)`). */
      readonly targetVersion: number
    }

export type PromoteLockedSnapshot = (locked: LockedSnapshot) => Promise<PromoteLockedSnapshotResult>

/** Lê e valida o manifesto; devolve também os bytes (o sha256 do lock é sobre eles). */
async function loadManifest(
  deps: SnapshotDeps,
  manifestKey: string,
): Promise<{ readonly raw: Uint8Array; readonly manifest: SnapshotManifest }> {
  const raw = await deps.blobs.get(BlobStoreName.CorpusSnapshots, manifestKey)
  if (raw === null) {
    throw new SnapshotError(`manifesto ${manifestKey} não existe no store corpus-snapshots`)
  }
  return { raw, manifest: parseManifest(raw, manifestKey) }
}

/** Checagens de versão, de migração e de arquivos, e a escrita (`SnapshotRepository.promote`). */
async function applyManifest(
  deps: SnapshotDeps,
  manifestKey: string,
  manifest: SnapshotManifest,
  rollback: boolean,
): Promise<PromoteSnapshotResult> {
  const current = await deps.snapshots.currentCorpusVersion()
  const older = current !== null && current > manifest.corpusVersion
  if (rollback && !older) {
    throw new SnapshotError(
      `rollback só repromove snapshot mais antigo que o destino (destino ${String(current)}, ` +
        `snapshot ${String(manifest.corpusVersion)})`,
    )
  }
  if (!rollback && older) {
    throw new SnapshotError(
      `o destino já está na versão ${String(current)}, mais nova que o snapshot ` +
        `${String(manifest.corpusVersion)} (para voltar a ele, use --rollback)`,
    )
  }
  const migration = await deps.snapshots.latestMigration()
  const compatible = rollback
    ? await deps.snapshots.migrationApplied(manifest.migration.hash)
    : migration?.hash === manifest.migration.hash
  if (!compatible) {
    throw new SnapshotError(
      `migração do destino (${migration?.name ?? 'nenhuma'}) incompatível com a do snapshot ` +
        `(${manifest.migration.name ?? manifest.migration.hash}): rode as migrações antes`,
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
    ...(rollback
      ? {
          rollbackNotes: `rollback para o snapshot ${String(manifest.corpusVersion)} (${manifestKey})`,
        }
      : {}),
  })
  if (!rollback) {
    return { corpusVersion: manifest.corpusVersion, rows }
  }
  const corpusVersion = await deps.snapshots.currentCorpusVersion()
  return { corpusVersion: corpusVersion ?? manifest.corpusVersion, rows }
}

export function createPromoteSnapshot(deps: SnapshotDeps): PromoteSnapshot {
  return async ({ manifestKey, rollback = false }) => {
    const { manifest } = await loadManifest(deps, manifestKey)
    return applyManifest(deps, manifestKey, manifest, rollback)
  }
}

/**
 * Confere o sha256 dos bytes do manifesto e a versão contra o lock antes de qualquer outra coisa.
 * Idempotente: com o destino já na versão do lock (`up-to-date`) ou à frente dela (`target-newer`,
 * depois de um rollback de corpus), não escreve nada; nunca faz rollback. Fora isso, as mesmas
 * checagens e a mesma escrita do `PromoteSnapshot`, sobre o manifesto já conferido.
 */
export function createPromoteLockedSnapshot(deps: SnapshotDeps): PromoteLockedSnapshot {
  return async (locked) => {
    const { raw, manifest } = await loadManifest(deps, locked.manifestKey)
    const sha256 = deps.codec.sha256(raw)
    if (sha256 !== locked.manifestSha256) {
      throw new SnapshotError(
        `sha256 do manifesto ${locked.manifestKey} (${sha256}) difere do lock ` +
          `(${locked.manifestSha256})`,
      )
    }
    if (manifest.corpusVersion !== locked.corpusVersion) {
      throw new SnapshotError(
        `o manifesto ${locked.manifestKey} é da versão ${String(manifest.corpusVersion)}, ` +
          `e o lock diz ${String(locked.corpusVersion)}`,
      )
    }
    const target = await deps.snapshots.currentCorpusVersion()
    if (target !== null && target >= manifest.corpusVersion) {
      return {
        status: target === manifest.corpusVersion ? 'up-to-date' : 'target-newer',
        corpusVersion: manifest.corpusVersion,
        targetVersion: target,
      }
    }
    const promoted = await applyManifest(deps, locked.manifestKey, manifest, false)
    return { status: 'promoted', ...promoted }
  }
}
