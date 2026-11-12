import { parseArgs } from 'node:util'
import { type ExportSnapshot, snapshotManifestKey } from '#app/use-cases/export-snapshot.ts'
import type { PromoteSnapshot } from '#app/use-cases/promote-snapshot.ts'

/**
 * Subcomandos `cli snapshot export` e `cli snapshot promote` (despachados pelo `src/cli.ts`). As
 * dependências chegam prontas (o container de ingestão, com o banco do alvo e o Blobs), então os
 * handlers só leem os argumentos, chamam o caso de uso e imprimem uma linha JSON por resultado, que
 * o workflow lê.
 *
 * - `snapshot export [--corpus-version <n>]`: staging, depois do `RefreshCoverage`.
 * - `snapshot promote (--manifest <chave> | --corpus-version <n>)`: produção (job `promote-corpus`),
 *   depois da fase `migrate` do deploy.
 */

export interface SnapshotCliDeps {
  readonly exportSnapshot: ExportSnapshot
  readonly promoteSnapshot: PromoteSnapshot
  /** Saída de uma linha (o `cli.ts` passa `console.log`). */
  readonly print: (line: string) => void
}

/** Uso incorreto (como o `EX_USAGE` do sysexits). */
export const EXIT_USAGE = 64

const SNAPSHOT_USAGE = [
  'uso: cli snapshot export [--corpus-version <n>]',
  '     cli snapshot promote (--manifest <chave> | --corpus-version <n>)',
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

function parse(args: readonly string[], options: { readonly manifest: boolean }) {
  try {
    return parseArgs({
      args: [...args],
      options: {
        'corpus-version': { type: 'string' },
        ...(options.manifest ? { manifest: { type: 'string' as const } } : {}),
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new SnapshotUsageError(error instanceof Error ? error.message : String(error))
  }
}

export async function runSnapshotExport(
  deps: SnapshotCliDeps,
  args: readonly string[],
): Promise<void> {
  const values = parse(args, { manifest: false })
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

export async function runSnapshotPromote(
  deps: SnapshotCliDeps,
  args: readonly string[],
): Promise<void> {
  const values = parse(args, { manifest: true })
  const manifest = typeof values.manifest === 'string' ? values.manifest : undefined
  const corpusVersion = parseVersion(values['corpus-version'])
  if ((manifest === undefined) === (corpusVersion === undefined)) {
    throw new SnapshotUsageError('informe --manifest ou --corpus-version (um dos dois)')
  }
  const manifestKey = manifest ?? snapshotManifestKey(corpusVersion ?? 0)
  const result = await deps.promoteSnapshot({ manifestKey })
  deps.print(
    JSON.stringify({ manifestKey, corpusVersion: result.corpusVersion, rows: result.rows }),
  )
}
