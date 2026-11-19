import { parseArgs } from 'node:util'
import {
  type ExportSnapshot,
  SnapshotError,
  snapshotManifestKey,
} from '#app/use-cases/export-snapshot.ts'
import type { PromoteLockedSnapshot, PromoteSnapshot } from '#app/use-cases/promote-snapshot.ts'
import type { CorpusLock } from '../ingest/corpus-lock.ts'

/**
 * Subcomandos `cli snapshot export` e `cli snapshot promote` (despachados pelo `src/cli.ts`). As
 * dependências chegam prontas (o container do snapshot, com o banco do alvo e o store de blobs),
 * então os handlers só leem os argumentos, chamam o caso de uso e imprimem uma linha JSON por
 * resultado, que o workflow lê.
 *
 * - `snapshot export [--corpus-version <n>]`: staging, depois do `RefreshCoverage`.
 * - `snapshot promote --lock <corpus.lock.json>`: produção (passo `promote-corpus` do job `deploy`),
 *   depois das migrações. Promove o snapshot do lock, conferido pelo `manifestSha256`; com a
 *   produção já nele ou à frente dele, não faz nada (`status` `up-to-date` ou `target-newer`).
 * - `snapshot promote (--manifest <chave> | --corpus-version <n>) [--rollback]`: promoção manual.
 *   `--rollback` repromove explicitamente um snapshot mais antigo que o destino, como uma versão
 *   nova do corpus (`docs/runbooks/rollback-corpus.md`).
 */

export interface SnapshotCliDeps {
  readonly exportSnapshot: ExportSnapshot
  readonly promoteSnapshot: PromoteSnapshot
  readonly promoteLockedSnapshot: PromoteLockedSnapshot
  /** Lê e valida o `corpus.lock.json` (o `cli.ts` passa `readCorpusLock`). */
  readonly readLock: (file: string) => Pick<CorpusLock, 'snapshot'>
  /** Saída de uma linha (o `cli.ts` passa `console.log`). */
  readonly print: (line: string) => void
}

/** Uso incorreto (como o `EX_USAGE` do sysexits). */
export const EXIT_USAGE = 64

const SNAPSHOT_USAGE = [
  'uso: cli snapshot export [--corpus-version <n>]',
  '     cli snapshot promote --lock <corpus.lock.json>',
  '     cli snapshot promote (--manifest <chave> | --corpus-version <n>) [--rollback]',
].join('\n')

export class SnapshotUsageError extends Error {
  readonly exitCode = EXIT_USAGE

  constructor(message: string) {
    super(`${message}\n${SNAPSHOT_USAGE}`)
    this.name = 'SnapshotUsageError'
  }
}

function parseVersion(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!/^[1-9]\d*$/.test(value)) {
    throw new SnapshotUsageError(`--corpus-version precisa ser um inteiro positivo: ${value}`)
  }
  return Number(value)
}

function parse(args: readonly string[], options: { readonly promote: boolean }) {
  try {
    return parseArgs({
      args: [...args],
      options: {
        'corpus-version': { type: 'string' },
        ...(options.promote
          ? {
              manifest: { type: 'string' as const },
              lock: { type: 'string' as const },
              rollback: { type: 'boolean' as const, default: false },
            }
          : {}),
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new SnapshotUsageError(error instanceof Error ? error.message : String(error))
  }
}

export async function runSnapshotExport(
  deps: Pick<SnapshotCliDeps, 'exportSnapshot' | 'print'>,
  args: readonly string[],
): Promise<void> {
  const values = parse(args, { promote: false })
  const corpusVersion = parseVersion(values['corpus-version'])
  const result = await deps.exportSnapshot(corpusVersion === undefined ? {} : { corpusVersion })
  deps.print(
    JSON.stringify({
      manifestKey: result.manifestKey,
      corpusVersion: result.manifest.corpusVersion,
      migration: result.manifest.migration,
      rows: Object.fromEntries(result.manifest.tables.map((table) => [table.name, table.rows])),
    }),
  )
}

async function promoteFromLock(
  deps: Pick<SnapshotCliDeps, 'promoteLockedSnapshot' | 'readLock' | 'print'>,
  file: string,
): Promise<void> {
  const { snapshot } = deps.readLock(file)
  if (snapshot === null) {
    throw new SnapshotError(`${file} não tem snapshot: nada a promover`)
  }
  const result = await deps.promoteLockedSnapshot({
    manifestKey: snapshot.manifestKey,
    corpusVersion: snapshot.corpusVersion,
    manifestSha256: snapshot.manifestSha256,
  })
  deps.print(JSON.stringify({ manifestKey: snapshot.manifestKey, ...result }))
}

export async function runSnapshotPromote(
  deps: Omit<SnapshotCliDeps, 'exportSnapshot'>,
  args: readonly string[],
): Promise<void> {
  const values = parse(args, { promote: true })
  const manifest = typeof values.manifest === 'string' ? values.manifest : undefined
  const lock = typeof values.lock === 'string' ? values.lock : undefined
  const corpusVersion = parseVersion(values['corpus-version'])
  const rollback = values.rollback === true
  if (lock !== undefined) {
    if (manifest !== undefined || corpusVersion !== undefined || rollback) {
      throw new SnapshotUsageError(
        '--lock não se combina com --manifest, --corpus-version nem --rollback',
      )
    }
    await promoteFromLock(deps, lock)
    return
  }
  if ((manifest === undefined) === (corpusVersion === undefined)) {
    throw new SnapshotUsageError('informe --lock, --manifest ou --corpus-version (um dos três)')
  }
  const manifestKey = manifest ?? snapshotManifestKey(corpusVersion ?? 0)
  const result = await deps.promoteSnapshot(rollback ? { manifestKey, rollback } : { manifestKey })
  deps.print(
    JSON.stringify({
      manifestKey,
      corpusVersion: result.corpusVersion,
      rows: result.rows,
      ...(rollback ? { rollback } : {}),
    }),
  )
}
