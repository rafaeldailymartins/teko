import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_FIXTURE_DIR, seedFixtures } from '#adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import { createContainer, migrateDatabase } from './composition-root.ts'
import { EnvValidationError, parseEnv } from './config/env.ts'

/**
 * Entrypoint da CLI (`pnpm --filter @teko/api cli <subcomando>`; empacotada como `dist/cli.mjs`).
 * Roda só no Actions e localmente, nunca na Vercel. Subcomandos desta fase:
 *
 * - `seed-fixtures [--dir test/fixtures/corpus] [--migrate] [--replace]`: grava a fixture única
 *   no banco de `DATABASE_URL` (URL do owner). `--migrate` aplica as migrações antes; `--replace`
 *   esvazia o corpus na mesma transação.
 *
 * `ingest`, `sources-watch` e `eval-fixture` chegam na F3; `maintenance`, na F4.
 */

/**
 * `apps/api/drizzle/migrations`, relativo a este módulo: vale para `src/cli.ts` (pnpm) e para o
 * bundle `dist/cli.mjs` (Actions), ambos um nível abaixo de `apps/api`.
 */
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle/migrations', import.meta.url))

const USAGE = `uso: cli seed-fixtures [--dir <dir>] [--migrate] [--replace]`

/** A CLI não serve HTTP: `WEB_ORIGIN` só existe para o env da API validar. */
const CLI_ENV_DEFAULTS = { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' } as const

async function runSeedFixtures(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      dir: { type: 'string', default: DEFAULT_FIXTURE_DIR },
      migrate: { type: 'boolean', default: false },
      replace: { type: 'boolean', default: false },
    },
    strict: true,
  })
  const env = parseEnv({ ...CLI_ENV_DEFAULTS, ...process.env })
  if (env.DATABASE_URL === undefined) {
    throw new Error('seed-fixtures exige DATABASE_URL (URL direta do owner)')
  }
  if (values.migrate) {
    await migrateDatabase(env.DATABASE_URL, MIGRATIONS_FOLDER)
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
  } finally {
    await container.close()
  }
}

const COMMANDS: Readonly<Record<string, (args: readonly string[]) => Promise<void>>> = {
  'seed-fixtures': runSeedFixtures,
}

const [command, ...rest] = process.argv.slice(2)
const run = command === undefined ? undefined : COMMANDS[command]
if (run === undefined) {
  console.error(USAGE)
  process.exitCode = 64
} else {
  try {
    await run(rest)
  } catch (error) {
    console.error(error instanceof EnvValidationError ? error.message : error)
    process.exitCode = 1
  }
}
