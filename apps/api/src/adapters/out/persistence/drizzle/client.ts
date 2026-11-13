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

/**
 * Padrões do plano (regras de CU-h, item 3): `{max: 3, idleTimeoutMillis: 5_000,
 * connectionTimeoutMillis: 8_000}` por instância. Os timeouts de consulta ficam no role.
 */
export const DEFAULT_MAX_CONNECTIONS = 3
const DEFAULT_IDLE_TIMEOUT_MS = 5000
const CONNECTION_TIMEOUT_MS = 8000

/**
 * Erros de conexão transitórios: `57P01` (`admin_shutdown`, o Neon encerrou a conexão ao suspender
 * o compute) e `ECONNRESET` (o socket caiu). Procurados também no `cause`, porque o Drizzle embrulha
 * o erro do `pg`.
 */
const TRANSIENT_CONNECTION_CODES: ReadonlySet<string> = new Set(['57P01', 'ECONNRESET'])

export function isTransientConnectionError(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const code: unknown = (current as { code?: unknown }).code
    if (typeof code === 'string' && TRANSIENT_CONNECTION_CODES.has(code)) {
      return true
    }
    current = current.cause
  }
  return false
}

/**
 * Retry único de uma leitura idempotente (plano, regras de CU-h, item 4): se a primeira tentativa
 * cair por erro de conexão transitório (a conexão do pool morreu com o scale-to-zero do Neon), a
 * leitura roda de novo, inteira, numa conexão nova. Só para leituras sem efeito: uma escrita ou uma
 * transação já confirmada pela metade nunca passa por aqui.
 */
export async function retryTransientRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    if (!isTransientConnectionError(error)) {
      throw error
    }
    return read()
  }
}

export function createDatabase(options: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString: options.url,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    idleTimeoutMillis: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    application_name: options.applicationName,
  })
  // Um erro numa conexão ociosa (ex.: compute do Neon suspenso) não pode derrubar o processo: o
  // pool descarta a conexão, e a próxima query abre outra (com o `retryTransientRead` nas leituras).
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
