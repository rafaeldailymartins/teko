import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { passkey } from '@better-auth/passkey'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { type AuthGateway, type AuthSession, CLIENT_IP_HEADER } from '#app/ports/auth-gateway.ts'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'
import { authSchema } from '../persistence/drizzle/schema/auth.ts'

/**
 * Better Auth (`docs/architecture/backend.md`, "Autenticação"): OAuth GitHub e Google, passkey
 * registrada depois do primeiro login, sessão por cookie e rate limit em banco (várias instâncias
 * Fluid). Sem e-mail e senha: não há remetente de e-mail sem domínio próprio.
 */

interface OAuthApp {
  readonly clientId: string
  readonly clientSecret: string
}

export interface BetterAuthConfig {
  /** `BETTER_AUTH_SECRET` (assina cookies e tokens). */
  readonly secret: string
  /** Origem exata do ambiente (`WEB_ORIGIN`): base URL, origem confiável e `rpID` da passkey. */
  readonly webOrigin: string
  /** Prefixo dos cookies: `teko` em produção, `teko-stg` fora dela. */
  readonly cookiePrefix: string
  readonly github: OAuthApp | null
  readonly google: OAuthApp | null
}

/** Sessão de 7 dias, renovada a cada dia de uso; `cookieCache` de 5 min (janela documentada no DSR). */
const SESSION_EXPIRES_IN_S = 604_800
const SESSION_UPDATE_AGE_S = 86_400
export const SESSION_COOKIE_CACHE_S = 300

export function createBetterAuthOptions(db: DrizzleDb, config: BetterAuthConfig) {
  const secure = config.webOrigin.startsWith('https://')
  return {
    appName: 'Tekó',
    baseURL: config.webOrigin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.webOrigin],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    socialProviders: {
      ...(config.github === null ? {} : { github: { ...config.github } }),
      ...(config.google === null ? {} : { google: { ...config.google } }),
    },
    plugins: [
      passkey({
        rpID: new URL(config.webOrigin).hostname,
        rpName: 'Tekó',
        origin: config.webOrigin,
      }),
    ],
    session: {
      expiresIn: SESSION_EXPIRES_IN_S,
      updateAge: SESSION_UPDATE_AGE_S,
      cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_S },
    },
    user: {
      additionalFields: {
        isAdult: { type: 'boolean', required: false, defaultValue: false, input: false },
        termsVersion: { type: 'string', required: false, input: false },
        termsAcceptedAt: { type: 'date', required: false, input: false },
        countryOfResidence: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      useSecureCookies: secure,
      cookiePrefix: config.cookiePrefix,
      database: { generateId: 'uuid' },
      // O handler HTTP grava aqui o IP da porta `ClientIp` (o `x-real-ip` na Vercel), e apaga o
      // header se vier do cliente.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    rateLimit: { enabled: true, storage: 'database' },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions
}

/** Converte o usuário do Better Auth (campos adicionais sem tipo forte) para a porta. */
function toSession(result: {
  readonly session: { readonly id: string; readonly expiresAt: Date }
  readonly user: Readonly<Record<string, unknown>>
}): AuthSession {
  const { user } = result
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  const date = (value: unknown): Date | null =>
    value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return {
    sessionId: result.session.id,
    expiresAt: result.session.expiresAt,
    user: {
      id: String(user['id']),
      name: String(user['name']),
      email: String(user['email']),
      image: text(user['image']),
      isAdult: user['isAdult'] === true,
      termsVersion: text(user['termsVersion']),
      termsAcceptedAt: date(user['termsAcceptedAt']),
      countryOfResidence: text(user['countryOfResidence']),
    },
  }
}

/** Cookies que o Better Auth grava para a sessão (com o prefixo e, em https, `__Secure-`). */
const SESSION_COOKIES = ['session_token', 'session_data', 'dont_remember'] as const

function clearCookieHeaders(
  config: Pick<BetterAuthConfig, 'cookiePrefix' | 'webOrigin'>,
): string[] {
  const secure = config.webOrigin.startsWith('https://')
  return SESSION_COOKIES.map(
    (name) =>
      `${secure ? '__Secure-' : ''}${config.cookiePrefix}.${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  )
}

export function createBetterAuthGateway(db: DrizzleDb, config: BetterAuthConfig): AuthGateway {
  const auth = betterAuth(createBetterAuthOptions(db, config))
  const clearing = clearCookieHeaders(config)
  return {
    clearSessionCookies: () => clearing,
    handle: (request) => auth.handler(request),
    async getSession(headers, options = {}) {
      const result = await auth.api.getSession({
        headers,
        ...(options.fresh === true ? { query: { disableCookieCache: true } } : {}),
      })
      return result === null ? null : toSession(result)
    },
  }
}
