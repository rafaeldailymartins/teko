import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import type {
  CoverageVerifiedReader,
  FamilyVerifiedAt,
} from '#app/ports/watch-coverage-repository.ts'
import { describeError, isMissingCorpusSchema, type WatchDatabaseUrl } from './run-coverage-mark.ts'

/**
 * `cli coverage-age --out <arquivo>` (job `coverage-age` do `ops.yml`, environment
 * `corpus-watch`). Lê `family` e `verified_at` de `corpus.coverage` nos dois bancos, com o role
 * `teko_watch` (`NEON_PROD_WATCH_URL` e `NEON_STAGING_WATCH_URL`), e grava um JSON que o job
 * `quotas` converte em `teko_coverage_verified_age_days`. A idade é calculada no envio, para que
 * um run atrasado não a subestime.
 *
 * Banco sem o schema `corpus` (a produção antes da primeira promoção, F7) sai sem famílias e com
 * aviso. Saída: 0 com os dois bancos lidos (ou sem schema); 1 se algum falhar (o JSON é gravado
 * mesmo assim, com o erro); 64 com argumentos inválidos.
 */

export const COVERAGE_AGE_USAGE = 'uso: cli coverage-age --out <arquivo.json>'

const ENVIRONMENT_OF: Readonly<Record<WatchDatabaseUrl['name'], 'production' | 'staging'>> = {
  'teko-prod': 'production',
  'teko-staging': 'staging',
}

export interface CoverageAgeTarget {
  readonly name: WatchDatabaseUrl['name']
  readonly reader: CoverageVerifiedReader
}

export interface CoverageAgeDeps {
  readonly targets: readonly CoverageAgeTarget[]
  readonly now: () => Date
  readonly log?: (line: string) => void
}

interface CoverageAgeDatabase {
  readonly name: WatchDatabaseUrl['name']
  readonly environment: 'production' | 'staging'
  readonly families: readonly FamilyVerifiedAt[]
  readonly missingSchema?: true
  readonly error?: string
}

export interface CoverageAgeReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly databases: readonly CoverageAgeDatabase[]
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function readTarget(
  target: CoverageAgeTarget,
  log: (line: string) => void,
): Promise<CoverageAgeDatabase> {
  const base = { name: target.name, environment: ENVIRONMENT_OF[target.name] }
  try {
    const families = await target.reader.listVerifiedAt()
    log(`${target.name}: ${String(families.length)} família(s)`)
    return { ...base, families }
  } catch (error) {
    if (isMissingCorpusSchema(error)) {
      log(
        `::warning title=coverage-age::${target.name}: sem o schema corpus (banco ainda não ` +
          'migrado), nada a medir',
      )
      return { ...base, families: [], missingSchema: true }
    }
    const message = describeError(error)
    log(`${target.name}: erro: ${message}`)
    return { ...base, families: [], error: message }
  }
}

export async function runCoverageAge(
  deps: CoverageAgeDeps,
  args: readonly string[],
): Promise<number> {
  const log = deps.log ?? writeLine
  let out: string | undefined
  try {
    out = parseArgs({
      args: [...args],
      options: { out: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values.out
  } catch (error) {
    log(`${error instanceof Error ? error.message : String(error)}\n${COVERAGE_AGE_USAGE}`)
    return 64
  }
  if (out === undefined || out.trim() === '') {
    log(COVERAGE_AGE_USAGE)
    return 64
  }
  const databases: CoverageAgeDatabase[] = []
  for (const target of deps.targets) {
    databases.push(await readTarget(target, log))
  }
  const report: CoverageAgeReport = {
    schemaVersion: 1,
    generatedAt: deps.now().toISOString(),
    databases,
  }
  const file = resolve(out)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(report)}\n`)
  return databases.some((database) => database.error !== undefined) ? 1 : 0
}
