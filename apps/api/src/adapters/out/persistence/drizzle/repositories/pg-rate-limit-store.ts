import type pg from 'pg'
import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'

/**
 * `RateLimitStore` em Postgres (`app.rate_limits`): janela fixa calculada pelo relógio do banco,
 * para que todas as instâncias da Fluid compute (e o Plano B) contem na mesma janela. Uma ida ao
 * banco por requisição limitada, sem transação explícita: o `INSERT … ON CONFLICT DO UPDATE` é
 * atômico. As janelas vencidas saem na manutenção semanal (`expires_at`).
 *
 * Não tem retry: o incremento não é idempotente. Uma falha vira 500 na rota limitada.
 */
const RATE_LIMIT_HIT_SQL = `INSERT INTO app.rate_limits AS r (key, window_start, count, expires_at)
SELECT $1::text, w.start, 1, w.start + make_interval(secs => $2::double precision / 1000)
FROM (SELECT to_timestamp(floor(extract(epoch FROM clock_timestamp()) * 1000 / $2::double precision)
                          * $2::double precision / 1000) AS start) w
ON CONFLICT (key, window_start) DO UPDATE SET count = r.count + 1
RETURNING r.count,
          greatest(0, ceil(extract(epoch FROM r.expires_at - clock_timestamp()) * 1000))::bigint
            AS reset_in_ms`

interface HitRow {
  readonly count: number
  readonly reset_in_ms: string
}

export function createPgRateLimitStore(pool: pg.Pool): RateLimitStore {
  return {
    async hit(key, windowMs) {
      const { rows } = await pool.query<HitRow>(RATE_LIMIT_HIT_SQL, [key, windowMs])
      const row = rows[0]
      if (row === undefined) {
        throw new Error('rate limit: o INSERT não devolveu linha')
      }
      return { count: row.count, resetInMs: Number(row.reset_in_ms) }
    },
  }
}
