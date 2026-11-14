import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import type pg from 'pg'
import { EXIT_USAGE } from '../ingest/cli-common.ts'

/**
 * `cli seed-dev-session`: cria (ou reaproveita) um usuário com onboarding concluído e uma sessão
 * do Better Auth direto no Postgres, sem OAuth, e imprime o cookie assinado. Serve ao login local
 * (`pnpm --filter @teko/api seed:dev-session`) e ao e2e da stack de CI. Só development e ci: a
 * CLI recusa staging e produção.
 *
 * O cookie segue o formato do Better Auth: `[__Secure-]<prefixo>.session_token` com o valor
 * `token.assinatura` (HMAC-SHA256 do token com o `BETTER_AUTH_SECRET`, em base64), URL-encoded.
 */
export interface DevSessionOptions {
  readonly secret: string
  readonly cookiePrefix: string
  /** Origem https usa o prefixo `__Secure-`. */
  readonly secure: boolean
  readonly email: string
  readonly name: string
  readonly termsVersion: string
  readonly countryOfResidence: string
  readonly now: Date
  readonly ttlSeconds: number
}

export interface DevSession {
  readonly userId: string
  readonly cookieName: string
  readonly cookieValue: string
  readonly expiresAt: Date
}

export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64')
  return encodeURIComponent(`${token}.${signature}`)
}

export function sessionCookieName(cookiePrefix: string, secure: boolean): string {
  return `${secure ? '__Secure-' : ''}${cookiePrefix}.session_token`
}

const UPSERT_USER_SQL = `INSERT INTO auth."user"
  (id, name, email, email_verified, is_adult, terms_version, terms_accepted_at,
   country_of_residence, created_at, updated_at)
VALUES ($1, $2, $3, true, true, $4, $5, $6, $5, $5)
ON CONFLICT (email) DO UPDATE SET is_adult = true, terms_version = EXCLUDED.terms_version,
  terms_accepted_at = EXCLUDED.terms_accepted_at,
  country_of_residence = EXCLUDED.country_of_residence, updated_at = EXCLUDED.updated_at
RETURNING id`

const INSERT_SESSION_SQL = `INSERT INTO auth.session
  (id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id)
VALUES ($1, $2, $3, $4, $4, NULL, 'teko-seed-dev-session', $5)`

export async function createDevSession(
  pool: pg.Pool,
  options: DevSessionOptions,
): Promise<DevSession> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ id: string }>(UPSERT_USER_SQL, [
      randomUUID(),
      options.name,
      options.email,
      options.termsVersion,
      options.now,
      options.countryOfResidence,
    ])
    const userId = rows[0]?.id
    if (userId === undefined) {
      throw new Error('seed-dev-session: o INSERT do usuário não devolveu linha')
    }
    const token = randomBytes(24).toString('base64url')
    const expiresAt = new Date(options.now.getTime() + options.ttlSeconds * 1000)
    await client.query(INSERT_SESSION_SQL, [randomUUID(), expiresAt, token, options.now, userId])
    await client.query('COMMIT')
    return {
      userId,
      cookieName: sessionCookieName(options.cookiePrefix, options.secure),
      cookieValue: signSessionToken(token, options.secret),
      expiresAt,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export interface DevSessionArgs {
  readonly email: string
  readonly name: string
  readonly country: string
}

/** `--email`, `--name` e `--country` (padrões: o usuário de desenvolvimento, Brasil). */
export function parseDevSessionArgs(args: readonly string[]): DevSessionArgs {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        email: { type: 'string', default: 'dev@teko.localhost' },
        name: { type: 'string', default: 'Dev Tekó' },
        country: { type: 'string', default: 'BR' },
      },
      strict: true,
    })
    if (!/^[A-Z]{2}$/.test(values.country)) {
      throw new Error('--country deve ser ISO 3166-1 alpha-2 (ex.: BR)')
    }
    return { email: values.email, name: values.name, country: values.country }
  } catch (error) {
    throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), {
      exitCode: EXIT_USAGE,
    })
  }
}
