import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

/**
 * Aplica as migrações de `apps/api/drizzle/migrations` (as mesmas do `drizzle-kit migrate` do
 * deploy). Usado pelos testes de integração, pelo `seed-fixtures` e pelo `sql-perf`; sempre com a
 * URL direta do owner, nunca a do pooler.
 */
const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../../../../drizzle/migrations', import.meta.url),
)

export async function runMigrations(
  url: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const client = new pg.Client({ connectionString: url, application_name: 'teko-migrate' })
  await client.connect()
  try {
    await migrate(drizzle({ client }), { migrationsFolder })
  } finally {
    await client.end()
  }
}
