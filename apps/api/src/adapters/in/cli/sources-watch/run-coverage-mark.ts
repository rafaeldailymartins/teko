import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { CoverageWatchRepository } from '#app/ports/watch-coverage-repository.ts'
import { markCoverage } from '#app/use-cases/mark-coverage.ts'
import { parseDiscoveredReport } from './discovered-schema.ts'

/**
 * `cli coverage-mark --discovered <discovered.json>` (job `mark-coverage` do `source-watch.yml`,
 * environment `corpus-watch`). Marca a cobertura nos dois bancos com o role `teko_watch`
 * (`NEON_PROD_WATCH_URL` e `NEON_STAGING_WATCH_URL`, ver {@link resolveWatchDatabaseUrls}); nunca
 * recebe o PAT da Netlify.
 *
 * Saída: 0 com todos os bancos marcados; 1 se algum banco falhar (os demais seguem) ou se o
 * `discovered.json` for inválido; 64 com argumentos inválidos.
 */

export interface CoverageMarkTarget {
  /** Nome para o log (`teko-prod`, `teko-staging`). */
  readonly name: string
  readonly repository: CoverageWatchRepository
}

export interface CoverageMarkDeps {
  readonly targets: readonly CoverageMarkTarget[]
  readonly log?: (line: string) => void
}

export const COVERAGE_MARK_USAGE = 'uso: cli coverage-mark --discovered <discovered.json>'

export interface WatchDatabaseUrl {
  readonly name: 'teko-prod' | 'teko-staging'
  readonly url: string
}

export class WatchEnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchEnvError'
  }
}

/**
 * URLs do role `teko_watch` nos dois projetos do Neon, lidas do ambiente. As duas são
 * obrigatórias: marcar só um banco deixaria a cobertura de prod e a do staging divergentes.
 */
export function resolveWatchDatabaseUrls(
  env: Readonly<Record<string, string | undefined>>,
): WatchDatabaseUrl[] {
  const entries = [
    { name: 'teko-prod', variable: 'NEON_PROD_WATCH_URL' },
    { name: 'teko-staging', variable: 'NEON_STAGING_WATCH_URL' },
  ] as const
  const missing = entries.filter((entry) => !env[entry.variable]?.trim())
  if (missing.length > 0) {
    throw new WatchEnvError(
      `coverage-mark exige ${missing.map((entry) => entry.variable).join(' e ')} ` +
        '(role teko_watch, environment corpus-watch)',
    )
  }
  return entries.map((entry) => {
    const url = env[entry.variable]?.trim() ?? ''
    if (!/^postgres(ql)?:\/\//u.test(url)) {
      throw new WatchEnvError(`${entry.variable} precisa começar com postgresql://`)
    }
    return { name: entry.name, url }
  })
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

export async function runCoverageMark(
  deps: CoverageMarkDeps,
  args: readonly string[],
): Promise<number> {
  const log = deps.log ?? writeLine
  let discovered: string | undefined
  try {
    discovered = parseArgs({
      args: [...args],
      options: { discovered: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values.discovered
  } catch (error) {
    log(`${error instanceof Error ? error.message : String(error)}\n${COVERAGE_MARK_USAGE}`)
    return 64
  }
  if (discovered === undefined) {
    log(COVERAGE_MARK_USAGE)
    return 64
  }
  let report: ReturnType<typeof parseDiscoveredReport>
  try {
    report = parseDiscoveredReport(await readFile(discovered, 'utf8'))
  } catch (error) {
    // Arquivo ausente (artifact do `detect` não baixado) ou conteúdo inválido.
    log(`erro: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  let failed = 0
  for (const target of deps.targets) {
    try {
      const result = await markCoverage(target.repository, { report })
      const excluded =
        result.excludedFamilies.length === 0
          ? ''
          : `; sem avanço: ${result.excludedFamilies.join(', ')}`
      log(
        `${target.name}: verified_at=${result.verifiedAt} em ${String(result.verifiedRows)} família(s), ` +
          `${String(result.gapRows)} lacuna(s)${excluded}`,
      )
      for (const gap of result.gaps) {
        log(`  lacuna ${gap.family} desde ${gap.from}: ${gap.reason}`)
      }
    } catch (error) {
      failed += 1
      log(`${target.name}: erro: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return failed === 0 ? 0 : 1
}
