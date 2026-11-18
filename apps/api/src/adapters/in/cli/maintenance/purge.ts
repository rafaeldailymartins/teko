import { parseArgs } from 'node:util'
import type { PurgeExpiredData } from '#app/use-cases/privacy.ts'
import { describeError, isMissingCorpusSchema } from '../sources-watch/run-coverage-mark.ts'

/**
 * `cli maintenance purge [--allow-missing-schema]` (job `weekly-maintenance` do `ops.yml`):
 * `PurgeExpiredData` sobre `DATABASE_URL` (role `teko_app`) e uma linha JSON com as contagens.
 *
 * `--allow-missing-schema` existe para a produção antes do primeiro deploy (F7): sem as tabelas de
 * `app` e `auth` (SQLSTATE `42P01`/`3F000`), o comando avisa, imprime `{"skipped":"schema_missing"}`
 * e termina com 0. Qualquer outro erro continua sendo falha.
 */
export interface PurgeOptions {
  readonly allowMissingSchema: boolean
}

export function parsePurgeArgs(args: readonly string[]): PurgeOptions {
  const { values } = parseArgs({
    args: [...args],
    options: { 'allow-missing-schema': { type: 'boolean', default: false } },
    strict: true,
    allowPositionals: false,
  })
  return { allowMissingSchema: values['allow-missing-schema'] }
}

export async function runPurge(
  purge: PurgeExpiredData,
  options: PurgeOptions,
  io: { readonly print: (line: string) => void; readonly warn: (line: string) => void },
): Promise<number> {
  try {
    io.print(JSON.stringify(await purge()))
    return 0
  } catch (error) {
    if (options.allowMissingSchema && isMissingCorpusSchema(error)) {
      io.warn(`maintenance purge: schema ausente, nada a expurgar (${describeError(error)})`)
      io.print(JSON.stringify({ skipped: 'schema_missing' }))
      return 0
    }
    throw error
  }
}
