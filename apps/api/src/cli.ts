import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isoDateInTimeZone } from '@teko/shared/vigencia'
import {
  type EvalFixtureDeps,
  runEvalFixtureExport,
} from '#adapters/in/cli/eval-fixture/eval-fixture.ts'
import { EXIT_FAILURE, EXIT_USAGE } from '#adapters/in/cli/ingest/cli-common.ts'
import { runIngestDiscover } from '#adapters/in/cli/ingest/discover.ts'
import { runIngestLoad } from '#adapters/in/cli/ingest/load.ts'
import { loadOverrides } from '#adapters/in/cli/ingest/overrides-loader.ts'
import { PARSER_REVISIONS, PARSERS } from '#adapters/in/cli/ingest/parsers/index.ts'
import { allowedHostsOf, loadCorpusConfig } from '#adapters/in/cli/ingest/sources.ts'
import { DEFAULT_FIXTURE_DIR, seedFixtures } from '#adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import { runSnapshotExport, runSnapshotPromote } from '#adapters/in/cli/snapshot/snapshot.ts'
import {
  resolveWatchDatabaseUrls,
  runCoverageMark,
} from '#adapters/in/cli/sources-watch/run-coverage-mark.ts'
import { runSourcesWatch } from '#adapters/in/cli/sources-watch/run-sources-watch.ts'
import { loadWatchConfig } from '#adapters/in/cli/sources-watch/watch-config.ts'
import type { IngestionContainer } from '#app/container.ts'
import type { BlobStore } from '#app/ports/blob-store.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import {
  createContainer,
  createCoverageMarkTargets,
  createFixtureCorpusReader,
  createIngestionContainer,
  createIngestionIo,
  migrateDatabase,
} from './composition-root.ts'
import { type Env, EnvValidationError, loadCliEnv, loadWatchEnv } from './config/env.ts'

/**
 * Entrypoint da CLI (`pnpm --filter @teko/api cli <subcomando>`; empacotada como `dist/cli.mjs`).
 * Roda só no Actions e localmente, nunca na Vercel. Subcomandos:
 *
 * - `seed-fixtures [--dir test/fixtures/corpus] [--migrate] [--replace]`: grava a fixture única
 *   no banco de `DATABASE_URL` (URL do owner);
 * - `ingest discover …` e `ingest load …` (F3): ver `adapters/in/cli/ingest/{discover,load}.ts`;
 * - `snapshot export|promote …` (F3): ver `adapters/in/cli/snapshot/snapshot.ts`;
 * - `eval-fixture export --from staging --out <dir>` (F3): regenera a fixture a partir do staging;
 * - `sources-watch [--config <watch.yaml>] [--out <dir>] [--dry-run]` (F3, job `detect`): GETs
 *   condicionais e `discovered.json`, sem banco;
 * - `coverage-mark --discovered <discovered.json>` (F3, job `mark-coverage`): só lê
 *   `NEON_PROD_WATCH_URL` e `NEON_STAGING_WATCH_URL` (não passa pelo `loadCliEnv`).
 *
 * `maintenance` (F4) entra aqui também.
 *
 * Códigos de saída: 0 sucesso, 1 falha, 64 uso incorreto, 75 orçamento de neurons esgotado
 * (o `ingest.yml` retoma no dia seguinte).
 */

/**
 * `apps/api/drizzle/migrations` e `corpus/`, relativos a este módulo: valem para `src/cli.ts`
 * (pnpm) e para o bundle `dist/cli.mjs` (Actions), ambos um nível abaixo de `apps/api`.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/migrations', import.meta.url))
const CORPUS_DIR = fileURLToPath(new URL('../../../corpus', import.meta.url))
const CORPUS_LOCK_FILE = fileURLToPath(new URL('../../../corpus/corpus.lock.json', import.meta.url))
const OVERRIDES_DIR = fileURLToPath(new URL('../../../corpus/overrides', import.meta.url))
const WATCH_CONFIG_FILE = fileURLToPath(new URL('../../../corpus/watch.yaml', import.meta.url))

const USAGE = [
  'uso: cli seed-fixtures [--dir <dir>] [--migrate] [--replace]',
  '     cli ingest discover --target staging|production --out <dir> [--family <f>]',
  '     cli ingest load --target staging|production --plan <plan.json> --docling-dir <dir> [--bulk] [--migrate] [--report <arquivo>]',
  '     cli snapshot export [--corpus-version <n>] | snapshot promote (--manifest <chave> | --corpus-version <n>)',
  '     cli eval-fixture export --from staging --out <dir> [--fixture <dir>]',
].join('\n')

/** Saída de uma linha dos subcomandos (JSON que o workflow lê). */
function print(line: string): void {
  console.log(line)
}

function requireDatabaseUrl(env: Env, command: string): string {
  if (env.DATABASE_URL === undefined) {
    throw new Error(`${command} exige DATABASE_URL (URL direta do owner)`)
  }
  return env.DATABASE_URL
}

function ingestionContainer(env: Env, blobs: BlobStore, command: string): IngestionContainer {
  return createIngestionContainer(
    env,
    {
      databaseUrl: requireDatabaseUrl(env, command),
      embedNeuronBudget: env.EMBED_NEURON_BUDGET,
      maxDatabaseBytes: env.INGEST_MAX_DB_BYTES,
      ...(env.NEON_API_KEY_STAGING === undefined ? {} : { neonApiKey: env.NEON_API_KEY_STAGING }),
      ...(env.NEON_STAGING_PROJECT_ID === undefined
        ? {}
        : { neonProjectId: env.NEON_STAGING_PROJECT_ID }),
    },
    { blobStore: blobs },
  )
}

async function runSeedFixtures(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      dir: { type: 'string', default: DEFAULT_FIXTURE_DIR },
      migrate: { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const env = loadCliEnv()
  const databaseUrl = requireDatabaseUrl(env, 'seed-fixtures')
  if (values.migrate) {
    await migrateDatabase(databaseUrl, MIGRATIONS_FOLDER)
  }
  const container = createContainer(env, { applicationName: 'teko-cli' })
  try {
    const writeCorpus = container.useCases.writeCorpus
    if (writeCorpus === null) {
      throw new Error('seed-fixtures exige EMBEDDINGS_PROVIDER configurado')
    }
    const result = await seedFixtures(writeCorpus, values.dir, { replace: values.replace })
    console.log(
      `corpus_version ${String(result.corpusVersion)}: ${String(result.documents)} documentos, ` +
        `${String(result.provisionVersions)} redações, ${String(result.chunks)} chunks`,
    )
    return 0
  } finally {
    await container.close()
  }
}

async function runIngest(args: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = args
  // O uso vem antes de qualquer leitura do corpus/ ou do ambiente.
  if (subcommand !== 'discover' && subcommand !== 'load') {
    console.error(USAGE)
    return EXIT_USAGE
  }
  const env = loadCliEnv()
  const config = loadCorpusConfig(CORPUS_DIR)
  const io = createIngestionIo(env, allowedHostsOf(config))
  if (subcommand === 'discover') {
    return runIngestDiscover({ config, fetcher: io.fetcher, blobs: io.blobs, print }, rest)
  }
  const container = ingestionContainer(env, io.blobs, 'ingest load')
  try {
    return await runIngestLoad(
      {
        config,
        blobs: io.blobs,
        parsers: PARSERS,
        parserRevisions: PARSER_REVISIONS,
        overrides: loadOverrides(OVERRIDES_DIR),
        hasher: io.hasher,
        useCases: container.useCases,
        migrate: () => migrateDatabase(requireDatabaseUrl(env, 'ingest load'), MIGRATIONS_FOLDER),
        gitSha: env.GIT_SHA,
        today: () => isoDateInTimeZone(new Date()),
        defaultLockFile: CORPUS_LOCK_FILE,
        print,
      },
      rest,
    )
  } finally {
    await container.close()
  }
}

async function runSnapshot(args: readonly string[]): Promise<number> {
  const [subcommand, ...rest] = args
  if (subcommand !== 'export' && subcommand !== 'promote') {
    console.error(USAGE)
    return EXIT_USAGE
  }
  const env = loadCliEnv()
  const io = createIngestionIo(env, [])
  const container = ingestionContainer(env, io.blobs, `snapshot ${subcommand}`)
  try {
    const deps = { ...container.useCases, print }
    await (subcommand === 'export' ? runSnapshotExport(deps, rest) : runSnapshotPromote(deps, rest))
    return 0
  } finally {
    await container.close()
  }
}

async function runEvalFixture(args: readonly string[]): Promise<number> {
  const env = loadCliEnv()
  const reader = createFixtureCorpusReader(env)
  try {
    const deps: EvalFixtureDeps = { reader, print }
    return await runEvalFixtureExport(deps, args)
  } finally {
    await reader.close()
  }
}

/** Valor de `--config` (ou `--config=…`) nos argumentos, se houver. */
function configArg(args: readonly string[]): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg === '--config') {
      return args[index + 1]
    }
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length)
    }
  }
  return undefined
}

async function runWatch(args: readonly string[]): Promise<number> {
  const env = loadCliEnv()
  // O handler e a allowlist leem o mesmo watch.yaml: sem --config, o do repositório.
  const explicit = configArg(args)
  const watchFile = explicit ?? WATCH_CONFIG_FILE
  const watchArgs = explicit === undefined ? ['--config', watchFile, ...args] : args
  const watchHosts = (await loadWatchConfig(watchFile)).map(
    (page) => new URL(page.url.replaceAll('{yyyy}', '2026')).hostname,
  )
  const hosts = [...new Set([...allowedHostsOf(loadCorpusConfig(CORPUS_DIR)), ...watchHosts])].sort(
    compareCodeUnits,
  )
  const io = createIngestionIo(env, hosts)
  return runSourcesWatch({ fetcher: io.fetcher, blobs: io.blobs, clock: io.clock }, watchArgs)
}

async function runCoverage(args: readonly string[]): Promise<number> {
  const { targets, close } = createCoverageMarkTargets(resolveWatchDatabaseUrls(loadWatchEnv()))
  try {
    return await runCoverageMark({ targets }, args)
  } finally {
    await close()
  }
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<number>>> = {
  'seed-fixtures': runSeedFixtures,
  ingest: runIngest,
  snapshot: runSnapshot,
  'eval-fixture': runEvalFixture,
  'sources-watch': runWatch,
  'coverage-mark': runCoverage,
}

function exitCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'exitCode' in error) {
    const code = error.exitCode
    return typeof code === 'number' ? code : EXIT_FAILURE
  }
  return EXIT_FAILURE
}

const [command, ...rest] = process.argv.slice(2)
const run = command === undefined ? undefined : COMMANDS[command]
if (run === undefined) {
  console.error(USAGE)
  process.exitCode = EXIT_USAGE
} else {
  try {
    process.exitCode = await run(rest)
  } catch (error) {
    console.error(
      error instanceof EnvValidationError || exitCodeOf(error) === EXIT_USAGE
        ? error instanceof Error
          ? error.message
          : error
        : error,
    )
    process.exitCode = exitCodeOf(error)
  }
}
