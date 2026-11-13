import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { BlobStore } from '#app/ports/blob-store.ts'
import type { Clock } from '#app/ports/clock.ts'
import type { SafeFetcher } from '#app/ports/safe-fetcher.ts'
import type { DiscoveredReport } from '#app/ports/watch-report.ts'
import type { WatchSignalReader } from '#app/ports/watch-signals.ts'
import { WatchStateError, watchSources } from '#app/use-cases/watch-sources.ts'
import { createWatchSignalReader } from './signals.ts'
import { DEFAULT_WATCH_CONFIG, loadWatchConfig, WatchConfigError } from './watch-config.ts'

/**
 * `cli sources-watch [--config corpus/watch.yaml] [--out <dir>] [--dry-run]` (job `detect` do
 * `source-watch.yml`, environment `staging`). Lê e grava `corpus-manifests/watch-state.json` e
 * `discovered.json` no BlobStore (ADR 0030), faz os GETs condicionais pelo SafeFetcher e grava
 * `<out>/discovered.json` para o workflow (outputs e artifact do `mark-coverage`). Não toca o banco.
 *
 * Saída: 0 quando o run terminou, mesmo com páginas que falharam (elas ficam em `errors` e a
 * família em `unverifiedFamilies`; o workflow fica vermelho num job final); 1 com `watch.yaml` ou
 * `watch-state.json` inválidos; 64 com argumentos inválidos.
 */

export interface SourcesWatchDeps {
  readonly fetcher: SafeFetcher
  readonly blobs: BlobStore
  readonly clock: Clock
  readonly reader?: WatchSignalReader
  readonly log?: (line: string) => void
}

export const SOURCES_WATCH_USAGE =
  'uso: cli sources-watch [--config corpus/watch.yaml] [--out <dir>] [--dry-run]'

function summarize(report: DiscoveredReport): string[] {
  const lines = [
    `sources-watch ${report.runDate}: ${String(report.changes.length)} mudança(s), ` +
      `${String(report.errors.length)} erro(s)`,
  ]
  for (const item of report.changes) {
    lines.push(
      `  ${item.status === 'new' ? 'nova' : 'pendente'} ${item.family} (${item.kind}, ${item.mode}): ` +
        `${item.versionLabel ?? item.sourceUrl} desde ${item.effectiveFrom}`,
    )
  }
  for (const error of report.errors) {
    lines.push(`  erro ${error.pageId} (${error.family}): ${error.message}`)
  }
  return lines
}

function writeLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

export async function runSourcesWatch(
  deps: SourcesWatchDeps,
  args: readonly string[],
): Promise<number> {
  const log = deps.log ?? writeLine
  let values: { config: string; out: string; 'dry-run': boolean }
  try {
    values = parseArgs({
      args: [...args],
      options: {
        config: { type: 'string', default: DEFAULT_WATCH_CONFIG },
        out: { type: 'string', default: '.' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    log(`${error instanceof Error ? error.message : String(error)}\n${SOURCES_WATCH_USAGE}`)
    return 64
  }
  try {
    const pages = await loadWatchConfig(values.config)
    const report = await watchSources(
      {
        fetcher: deps.fetcher,
        blobs: deps.blobs,
        clock: deps.clock,
        reader: deps.reader ?? createWatchSignalReader(),
      },
      { pages, dryRun: values['dry-run'] },
    )
    await mkdir(values.out, { recursive: true })
    await writeFile(join(values.out, 'discovered.json'), `${JSON.stringify(report, null, 2)}\n`)
    for (const line of summarize(report)) {
      log(line)
    }
    return 0
  } catch (error) {
    if (error instanceof WatchConfigError || error instanceof WatchStateError) {
      log(`erro: ${error.message}`)
      return 1
    }
    throw error
  }
}
