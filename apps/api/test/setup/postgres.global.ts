import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import type { TestProject } from 'vitest/node'
import { runMigrations } from '#adapters/out/persistence/drizzle/migrate.ts'

/**
 * Banco de teste (globalSetup do Vitest, projetos `integration` e `sql-perf`): um container
 * pgvector 0.8.6 + PG 18 (paridade com o Neon) em tmpfs e com `fsync=off`.
 *
 * Espelha os papéis do Neon: `teko_owner` (dono do banco, roda as migrações e a ingestão, sem
 * superusuário), `teko_app` (runtime) e `teko_watch` (source-watch). Os roles existem ANTES das
 * migrações, como em produção, para que o bloco de grants da migração custom os configure. Depois
 * o banco migrado vira o template `teko_migrated`; cada arquivo de teste cria o seu banco a partir
 * dele (`test/setup/database.ts`), então os arquivos rodam em paralelo sem interferir.
 */

export const PGVECTOR_IMAGE =
  'pgvector/pgvector:0.8.6-pg18-trixie@sha256:78bf48b801e792f99e3ac62b5036fd3876e9be48afda16c1e331af1c75ceb2ff'

const SUPERUSER = 'postgres'
const SUPERUSER_PASSWORD = 'postgres-test-only'
const MIGRATED_DATABASE = 'teko'
export const TEMPLATE_DATABASE = 'teko_migrated'

/** Senhas só do container efêmero (nunca de um ambiente real). */
export const TEST_ROLES = {
  owner: { name: 'teko_owner', password: 'owner-test-only' },
  app: { name: 'teko_app', password: 'app-test-only' },
  watch: { name: 'teko_watch', password: 'watch-test-only' },
} as const

declare module 'vitest' {
  export interface ProvidedContext {
    pgHost: string
    pgPort: number
    pgSuperuserUri: string
  }
}

let container: StartedPostgreSqlContainer | undefined

function uriFor(host: string, port: number, user: string, password: string, database: string) {
  return `postgresql://${user}:${password}@${host}:${String(port)}/${database}`
}

export async function setup(project: TestProject): Promise<void> {
  container = await new PostgreSqlContainer(PGVECTOR_IMAGE)
    .withDatabase(MIGRATED_DATABASE)
    .withUsername(SUPERUSER)
    .withPassword(SUPERUSER_PASSWORD)
    .withTmpFs({ '/var/lib/postgresql': 'rw' })
    // O build paralelo do HNSW (sql-perf) usa memória compartilhada; o /dev/shm padrão é 64 MB.
    .withSharedMemorySize(1024 * 1024 * 1024)
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'full_page_writes=off',
      '-c',
      'synchronous_commit=off',
    ])
    .start()

  const host = container.getHost()
  const port = container.getPort()
  const superuserUri = uriFor(host, port, SUPERUSER, SUPERUSER_PASSWORD, MIGRATED_DATABASE)

  const admin = new pg.Client({ connectionString: superuserUri })
  await admin.connect()
  try {
    for (const role of Object.values(TEST_ROLES)) {
      await admin.query(`CREATE ROLE ${role.name} LOGIN PASSWORD '${role.password}'`)
    }
    // Como no Neon: o owner pode configurar os roles criados pela API (CREATEROLE + ADMIN OPTION,
    // exigidos pelo PG 16+ para `ALTER ROLE ... SET`), sem herdar os privilégios deles.
    await admin.query(`ALTER ROLE ${TEST_ROLES.owner.name} CREATEROLE`)
    await admin.query(
      `GRANT ${TEST_ROLES.app.name}, ${TEST_ROLES.watch.name} TO ${TEST_ROLES.owner.name} WITH ADMIN OPTION, INHERIT FALSE, SET FALSE`,
    )
    await admin.query(`ALTER DATABASE ${MIGRATED_DATABASE} OWNER TO ${TEST_ROLES.owner.name}`)
    await admin.query(`GRANT ALL ON SCHEMA public TO ${TEST_ROLES.owner.name}`)
    // No Neon o owner pertence a `neon_superuser` e pode criar `vector` (não é "trusted"); aqui o
    // superusuário cria as extensões antes, e o `CREATE EXTENSION IF NOT EXISTS` da migração vira
    // no-op, como no Neon quando a extensão já existe.
    for (const extension of ['vector', 'unaccent', 'pg_trgm', 'btree_gist']) {
      await admin.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`)
    }
  } finally {
    await admin.end()
  }

  await runMigrations(
    uriFor(host, port, TEST_ROLES.owner.name, TEST_ROLES.owner.password, MIGRATED_DATABASE),
  )
  await container.snapshot(TEMPLATE_DATABASE)

  project.provide('pgHost', host)
  project.provide('pgPort', port)
  project.provide('pgSuperuserUri', uriFor(host, port, SUPERUSER, SUPERUSER_PASSWORD, 'postgres'))
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
