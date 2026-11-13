import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isoDateSchema } from '@teko/shared/vigencia'
import { z } from 'zod'

/**
 * `corpus/corpus.lock.json`: o snapshot promovível (o PR que o atualiza é a porta para a produção)
 * e a versão (sha256) de cada fonte que o compõe. O `load` reescreve o arquivo só quando o
 * conteúdo muda (snapshot novo ou fonte nova), para não abrir PR de lock sem mudança; `updatedAt`
 * acompanha a mudança, nunca a execução.
 */

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

const lockSourceSchema = z.strictObject({
  sha256: sha256Schema,
  versionLabel: z.string().min(1),
  publishedOn: isoDateSchema,
})

const lockSnapshotSchema = z.strictObject({
  manifestKey: z.string().min(1),
  corpusVersion: z.int().positive(),
  createdAt: z.iso.datetime({ offset: true }),
  /** Hash da última migração aplicada no staging (o `promote` exige o mesmo em produção). */
  migration: z.string().min(1),
  /** sha256 do `manifest.json` como gravado no store `corpus-snapshots`. */
  manifestSha256: sha256Schema,
})

const LOCK_FORMAT = 1

const count = z.int().nonnegative()

/** Estado publicado de cada documento no snapshot do lock: a base do gate de saúde do `load`. */
const lockHealthSchema = z.strictObject({
  family: z.string().min(1),
  provisions: count,
  chunks: count,
  pending: count,
  versions: count,
})

const corpusLockSchema = z.strictObject({
  format: z.literal(LOCK_FORMAT),
  /** Versão do corpus do snapshot (o `ingest.yml` lê `.corpusVersion`); `null` antes do primeiro. */
  corpusVersion: z.int().positive().nullable(),
  snapshot: lockSnapshotSchema.nullable(),
  updatedAt: isoDateSchema.nullable(),
  sources: z.record(z.string(), lockSourceSchema),
  /** Por slug de documento; ausente num lock anterior ao gate (o primeiro run grava a base). */
  health: z.record(z.string(), lockHealthSchema).optional(),
})
export type CorpusLock = z.output<typeof corpusLockSchema>
type LockSnapshot = z.output<typeof lockSnapshotSchema>
type LockSource = z.output<typeof lockSourceSchema>
export type LockHealth = z.output<typeof lockHealthSchema>

export const EMPTY_LOCK: CorpusLock = {
  format: LOCK_FORMAT,
  corpusVersion: null,
  snapshot: null,
  updatedAt: null,
  sources: {},
}

export class CorpusLockError extends Error {
  constructor(file: string, cause: unknown) {
    super(`corpus.lock.json inválido: ${file}`, { cause })
    this.name = 'CorpusLockError'
  }
}

export function readCorpusLock(file: string): CorpusLock {
  if (!existsSync(file)) {
    return EMPTY_LOCK
  }
  const parsed = corpusLockSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    throw new CorpusLockError(file, parsed.error)
  }
  return parsed.data
}

function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : Number(a > b))))
}

export function serializeCorpusLock(lock: CorpusLock): string {
  const { health, ...rest } = lock
  return `${JSON.stringify(
    {
      ...rest,
      sources: sortedRecord(lock.sources),
      ...(health === undefined ? {} : { health: sortedRecord(health) }),
    },
    null,
    2,
  )}\n`
}

export interface LockUpdate {
  readonly snapshot: LockSnapshot | null
  readonly sources: Readonly<Record<string, LockSource>>
  readonly today: string
  /** Estado publicado no fim do run verde (substitui o anterior). */
  readonly health?: Readonly<Record<string, LockHealth>>
}

/**
 * Lock novo: fontes acrescentadas/atualizadas e, se houver, o snapshot novo. Devolve `null` quando
 * nada muda (o arquivo não deve ser reescrito).
 */
export function nextCorpusLock(current: CorpusLock, update: LockUpdate): CorpusLock | null {
  const snapshot = update.snapshot ?? current.snapshot
  const health = update.health ?? current.health
  const candidate: CorpusLock = {
    format: LOCK_FORMAT,
    corpusVersion: snapshot?.corpusVersion ?? current.corpusVersion,
    snapshot,
    updatedAt: current.updatedAt,
    sources: sortedRecord({ ...current.sources, ...update.sources }),
    ...(health === undefined ? {} : { health: sortedRecord(health) }),
  }
  if (serializeCorpusLock(candidate) === serializeCorpusLock(current)) {
    return null
  }
  return { ...candidate, updatedAt: update.today }
}

export function writeCorpusLock(file: string, lock: CorpusLock): void {
  writeFileSync(file, serializeCorpusLock(lock), 'utf8')
}
