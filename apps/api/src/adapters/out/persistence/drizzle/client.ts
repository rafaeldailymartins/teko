import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'

/**
 * Pool do `pg` + Drizzle. Driver: `pg` 8.23.1 (node-postgres), a única escolha com suporte
 * documentado ao `attachDatabasePool` da Vercel e ao `drizzle-orm/node-postgres`; nenhum driver
 * Postgres do npm é publicado com proveniência (exceção registrada no ADR 0002).
 *
 * - Runtime na Vercel: URL do `-pooler` do Neon (PgBouncer, modo transação), role `teko_app`, com
 *   os timeouts gravados no role. Por isso nenhum `SET` de sessão: só `SET LOCAL` dentro de
 *   transação.
 * - Ingestão, seed e migrações: URL direta do owner.
 */

/** Sem `relations`: as consultas do Tekó são SQL explícito ou o query builder, sem a API relacional. */
export type DrizzleDb = NodePgDatabase

export interface DatabaseOptions {
  readonly url: string
  /** Conexões por instância (a Fluid compute roda várias invocações na mesma instância). */
  readonly maxConnections?: number
  /** Nome que aparece em `pg_stat_activity` (`teko-api`, `teko-cli`...). */
  readonly applicationName: string
  /** Fecha conexões ociosas depois de N ms (curto na Vercel, para a instância poder suspender). */
  readonly idleTimeoutMs?: number
}

export interface Database {
  readonly pool: pg.Pool
  readonly db: DrizzleDb
  close(): Promise<void>
}

/** Conexão nova a cada erro de reconexão após o scale-to-zero do Neon (57P01, ECONNRESET). */
const DEFAULT_MAX_CONNECTIONS = 5
const DEFAULT_IDLE_TIMEOUT_MS = 5000
const CONNECTION_TIMEOUT_MS = 10_000

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    idleTimeoutMillis: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    application_name: options.applicationName,
  })
  // Um erro numa conexão ociosa (ex.: compute do Neon suspenso) não pode derrubar o processo; a
  // próxima query abre outra conexão.
  pool.on('error', () => {})
  const db = drizzle({ client: pool })
  let closed: Promise<void> | undefined
  return {
    pool,
    db,
    close: () => {
      closed ??= pool.end()
      return closed
    },
  }
}
