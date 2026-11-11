import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'
import { TEMPLATE_DATABASE, TEST_ROLES } from './postgres.global.ts'

/**
 * Banco isolado por arquivo de teste, criado a partir do template migrado do globalSetup. Devolve
 * as URLs de cada role (owner, app e watch) e uma função que apaga o banco no fim.
 */
export interface TestDatabase {
  readonly name: string
  readonly ownerUrl: string
  readonly appUrl: string
  readonly watchUrl: string
  drop(): Promise<void>
}

function roleUrl(role: { name: string; password: string }, database: string): string {
  return `postgresql://${role.name}:${role.password}@${inject('pgHost')}:${String(inject('pgPort'))}/${database}`
}

async function asSuperuser<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('pgSuperuserUri') })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `teko_test_${randomUUID().replaceAll('-', '')}`
  await asSuperuser((client) =>
    client.query(
      `CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE} OWNER ${TEST_ROLES.owner.name}`,
    ),
  )
  return {
    name,
    ownerUrl: roleUrl(TEST_ROLES.owner, name),
    appUrl: roleUrl(TEST_ROLES.app, name),
    watchUrl: roleUrl(TEST_ROLES.watch, name),
    drop: () =>
      asSuperuser(async (client) => {
        await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      }),
  }
}
