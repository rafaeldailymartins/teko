import type { IsoDate } from '@teko/shared/vigencia'
import { z } from 'zod'

/**
 * Snapshot promovível do corpus (plano, "Escrita, Blobs, snapshot e promoção"): um `.jsonl.zst` por
 * tabela do schema `corpus`, na ordem de FK, e um `manifest.json` com as contagens, o sha256 de cada
 * arquivo e o hash da última migração aplicada. Ficam de fora `embedding_cache`, `ingestion_runs`,
 * `review_queue`, as redações e chunks `pending`/`rejected` e as versões de documento que não
 * foram publicadas.
 *
 * O staging exporta (`SnapshotRepository.read`, leitura consistente numa transação só) e a produção
 * promove (`SnapshotRepository.promote`, upsert por chave natural numa transação, sem recalcular
 * embeddings). Os IDs `uuidv7()` do staging viajam no snapshot; as chaves naturais (`slug`,
 * `sha256`, `stable_key`, `(provision_version_id, ordinal)`) resolvem conflitos (ADR 0025).
 */

/** Ordem de FK: cada tabela só referencia as anteriores. */
export const SNAPSHOT_TABLES = [
  'documents',
  'document_versions',
  'amendments',
  'provisions',
  'provision_labels',
  'provision_versions',
  'chunks',
  'chunk_sources',
  'coverage',
  'corpus_versions',
] as const
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number]

export type SnapshotRow = Readonly<Record<string, unknown>>

/** Um objeto JSON (não nulo, não array) serve de linha. */
export function isSnapshotRow(value: unknown): value is SnapshotRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const SNAPSHOT_FORMAT = 1

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

export const snapshotManifestSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  corpusVersion: z.int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Última migração aplicada no banco exportado (`drizzle.__drizzle_migrations`). */
  migration: z.strictObject({ hash: z.string().min(1), name: z.string().nullable() }),
  tables: z
    .array(
      z.strictObject({
        name: z.enum(SNAPSHOT_TABLES),
        key: z.string().min(1),
        rows: z.int().nonnegative(),
        bytes: z.int().nonnegative(),
        sha256: sha256Schema,
      }),
    )
    .length(SNAPSHOT_TABLES.length)
    .refine((tables) => tables.every((table, index) => table.name === SNAPSHOT_TABLES[index]), {
      message: 'tabelas fora da ordem de FK',
    }),
})
export type SnapshotManifest = z.output<typeof snapshotManifestSchema>

export interface MigrationRef {
  readonly hash: string
  readonly name: string | null
}

export interface SnapshotReader {
  /** `max(corpus_versions.id)` no instante da leitura. */
  readonly corpusVersion: number | null
  readonly migration: MigrationRef | null
  /** Linhas exportáveis da tabela, em lotes, numa leitura consistente com as demais. */
  rows(table: SnapshotTable): AsyncIterable<readonly SnapshotRow[]>
}

export interface PromoteRecord {
  readonly manifest: SnapshotManifest
  /** Linhas de cada tabela, lidas sob demanda na ordem de `SNAPSHOT_TABLES`. */
  rows(table: SnapshotTable): AsyncIterable<readonly SnapshotRow[]>
  /** Data do fechamento do `knowledge` das linhas ausentes do snapshot. */
  readonly today: IsoDate
}

export interface SnapshotRepository {
  /** Abre uma leitura consistente (uma transação `REPEATABLE READ`, só leitura). */
  read<T>(work: (reader: SnapshotReader) => Promise<T>): Promise<T>
  latestMigration(): Promise<MigrationRef | null>
  currentCorpusVersion(): Promise<number | null>
  /** Aplica o snapshot numa transação; devolve as linhas lidas por tabela. */
  promote(record: PromoteRecord): Promise<Readonly<Record<SnapshotTable, number>>>
}

export interface EncodedTable {
  readonly data: Uint8Array
  readonly rows: number
  readonly sha256: string
}

/** JSON Lines comprimido com zstd e o sha256 do arquivo. */
export interface SnapshotCodec {
  encode(batches: AsyncIterable<readonly SnapshotRow[]>): Promise<EncodedTable>
  decode(data: Uint8Array): AsyncIterable<SnapshotRow[]>
  sha256(data: Uint8Array): string
}
