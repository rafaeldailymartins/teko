import { parseArgs } from 'node:util'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import {
  CliUsageError,
  EXIT_FAILURE,
  EXIT_OK,
  errorMessage,
  sha256Hex,
} from '../ingest/cli-common.ts'

/**
 * `cli ingest blobs-migrate [--store <nome>]... [--dry-run]` (etapa C1 da ADR 0030; workflow
 * `blobs-migrate.yml`, environment `staging`). Copia todos os artefatos da ingestão do Netlify
 * Blobs para o GitHub Releases: o cache do Docling (`corpus-raw`, `corpus-docling`), os snapshots
 * da promoção (`corpus-snapshots`), o estado do watch (`corpus-manifests`) e o histórico de evals
 * (`eval-artifacts`).
 *
 * Idempotente: a chave que já está no destino com o mesmo sha256 é pulada, e a que diverge é
 * trocada. Toda cópia é conferida depois de gravada (o sha256 que o destino informa precisa ser o
 * da origem). Imprime uma linha JSON por store e uma final, e sai com 1 se alguma chave falhar
 * (as outras seguem). A etapa C2 apaga este diretório inteiro.
 */

const BLOBS_MIGRATE_USAGE =
  'uso: cli ingest blobs-migrate [--store corpus-raw|corpus-docling|corpus-snapshots|corpus-manifests|eval-artifacts]... [--dry-run]'

/** O que o destino oferece além da porta: o sha256 do que está gravado, sem baixar se possível. */
interface Sha256Reader {
  sha256Of(store: BlobStoreName, key: string): Promise<string | null>
}

export interface BlobsMigrateDeps {
  readonly source: BlobStore
  readonly target: BlobStore & Sha256Reader
  readonly print: (line: string) => void
}

/** Ordem da cópia: primeiro o que o próximo ingest lê (cache do Docling), depois o resto. */
const MIGRATION_ORDER: readonly BlobStoreName[] = [
  BlobStoreName.CorpusRaw,
  BlobStoreName.CorpusDocling,
  BlobStoreName.CorpusSnapshots,
  BlobStoreName.CorpusManifests,
  BlobStoreName.EvalArtifacts,
]

const STORE_NAMES: ReadonlySet<string> = new Set(MIGRATION_ORDER)

function isStoreName(value: string): value is BlobStoreName {
  return STORE_NAMES.has(value)
}

interface StoreSummary {
  store: BlobStoreName
  total: number
  copied: number
  skipped: number
  failed: { key: string; error: string }[]
}

function parse(args: readonly string[]): { stores: BlobStoreName[]; dryRun: boolean } {
  let values: { store?: string[]; 'dry-run': boolean }
  try {
    values = parseArgs({
      args: [...args],
      options: {
        store: { type: 'string', multiple: true },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new CliUsageError(errorMessage(error), BLOBS_MIGRATE_USAGE)
  }
  const wanted = values.store ?? []
  const unknown = wanted.filter((store) => !isStoreName(store))
  if (unknown.length > 0) {
    throw new CliUsageError(`store desconhecido: ${unknown.join(', ')}`, BLOBS_MIGRATE_USAGE)
  }
  const stores = MIGRATION_ORDER.filter((store) => wanted.length === 0 || wanted.includes(store))
  return { stores, dryRun: values['dry-run'] }
}

async function migrateKey(
  deps: BlobsMigrateDeps,
  store: BlobStoreName,
  key: string,
  dryRun: boolean,
): Promise<'copied' | 'skipped'> {
  const bytes = await deps.source.get(store, key)
  if (bytes === null) {
    throw new Error('listada na origem, mas ausente na leitura')
  }
  const expected = sha256Hex(bytes)
  if ((await deps.target.sha256Of(store, key)) === expected) {
    return 'skipped'
  }
  if (dryRun) {
    return 'copied'
  }
  await deps.target.set(store, key, bytes)
  const written = await deps.target.sha256Of(store, key)
  if (written !== expected) {
    throw new Error(`sha256 no destino (${String(written)}) diferente da origem (${expected})`)
  }
  return 'copied'
}

export async function runBlobsMigrate(
  deps: BlobsMigrateDeps,
  args: readonly string[],
): Promise<number> {
  const { stores, dryRun } = parse(args)
  const summaries: StoreSummary[] = []
  for (const store of stores) {
    const keys = await deps.source.list(store)
    const summary: StoreSummary = { store, total: keys.length, copied: 0, skipped: 0, failed: [] }
    for (const key of keys) {
      try {
        summary[await migrateKey(deps, store, key, dryRun)] += 1
      } catch (error) {
        summary.failed.push({ key, error: errorMessage(error) })
      }
    }
    deps.print(JSON.stringify({ ...summary, dryRun }))
    summaries.push(summary)
  }
  const failed = summaries.reduce((sum, summary) => sum + summary.failed.length, 0)
  deps.print(
    JSON.stringify({
      dryRun,
      stores: summaries.length,
      total: summaries.reduce((sum, summary) => sum + summary.total, 0),
      copied: summaries.reduce((sum, summary) => sum + summary.copied, 0),
      skipped: summaries.reduce((sum, summary) => sum + summary.skipped, 0),
      failed,
    }),
  )
  return failed === 0 ? EXIT_OK : EXIT_FAILURE
}
