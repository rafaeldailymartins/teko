import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { passkey } from '@better-auth/passkey'
import {
  type EmailSignUpRequest,
  emailSignUpRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@teko/shared/contracts'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { type AuthGateway, type AuthSession, CLIENT_IP_HEADER } from '#app/ports/auth-gateway.ts'
import type { DrizzleDb } from '../persistence/drizzle/client.ts'
import { authSchema } from '../persistence/drizzle/schema/auth.ts'
import { authMethodsOf, type BetterAuthConfig, clearCookieHeaders } from './auth-config.ts'

/**
 * Better Auth (`docs/architecture/backend.md`, "Autenticação"): OAuth GitHub e Google, passkey
 * registrada depois do primeiro login, e-mail e senha (ADR 0036), sessão por cookie e rate limit em
 * banco (várias instâncias Fluid).
 *
 * E-mail e senha sem confirmação de e-mail nem recuperação de senha (não há remetente de e-mail sem
 * domínio próprio):
 *
 * - `autoSignIn: false` liga a proteção contra enumeração do Better Auth: o cadastro de um e-mail
 *   que já existe responde o mesmo 200 de um cadastro novo (usuário sintético, sem sessão e sem
 *   criar nada), e quem chama entra depois por `/sign-in/email`, cujo erro também é um só;
 * - a conta por senha nasce com `emailVerified: false`, e o Better Auth só liga implicitamente um
 *   OAuth a um usuário com o e-mail verificado: um GitHub ou Google com o mesmo e-mail não entra na
 *   conta de senha (e o cadastro por senha de um e-mail que já existe não cria credencial nele);
 * - as rotas de confirmação, troca de e-mail e recuperação de senha ficam desligadas (404).
 *
 * Este módulo carrega o SDK inteiro (com a passkey e o adapter do Drizzle): a raiz de composição o
 * alcança só por `lazy-better-auth.ts`, na primeira requisição de autenticação.
 */

/** Sessão de 7 dias, renovada a cada dia de uso; `cookieCache` de 5 min (janela documentada no DSR). */
const SESSION_EXPIRES_IN_S = 604_800
const SESSION_UPDATE_AGE_S = 86_400
export const SESSION_COOKIE_CACHE_S = 300

/**
 * Limites por IP (`x-teko-client-ip`) e caminho, mais rígidos que o padrão do Better Auth (3 a cada
 * 10 s em `/sign-in*` e `/sign-up*`): 5 entradas por minuto e 5 cadastros a cada 10 minutos. Acima
 * deles, 429 com `X-Retry-After`.
 */
export const EMAIL_RATE_LIMITS = {
  '/sign-in/email': { window: 60, max: 5 },
  '/sign-up/email': { window: 600, max: 5 },
} as const

/**
 * Rotas do Better Auth que dependem de mandar e-mail (confirmação, troca de e-mail e recuperação
 * de senha): sem remetente, ficam desligadas e respondem 404.
 */
export const DISABLED_AUTH_PATHS = [
  '/send-verification-email',
  '/verify-email',
  '/change-email',
  '/request-password-reset',
  '/reset-password',
] as const

/** Código do Better Auth para cada campo inválido do cadastro (a web escolhe a mensagem por ele). */
function signUpErrorCode(issue: { readonly path: readonly PropertyKey[]; readonly code: string }) {
  const [field] = issue.path
  if (field === 'password') {
    return issue.code === 'too_big' ? 'PASSWORD_TOO_LONG' : 'PASSWORD_TOO_SHORT'
  }
  if (field === 'email') {
    return 'INVALID_EMAIL'
  }
  return field === 'name' ? 'INVALID_NAME' : 'VALIDATION_ERROR'
}

/**
 * Corpo do cadastro por e-mail conforme `emailSignUpRequestSchema` (nome aparado de 1 a 80, sem
 * caractere de controle; e-mail de até 254; senha de 12 a 128; sem foto nem campo extra), ou
 * `APIError` 400 com o código do primeiro campo inválido.
 */
export function parseSignUpBody(body: unknown): EmailSignUpRequest {
  const parsed = emailSignUpRequestSchema.safeParse(body)
  if (parsed.success) {
    return parsed.data
  }
  const [issue] = parsed.error.issues
  throw new APIError('BAD_REQUEST', {
    code: issue === undefined ? 'VALIDATION_ERROR' : signUpErrorCode(issue),
    message: 'Invalid sign-up data',
  })
}

/** Antes do cadastro por e-mail: valida o corpo e repassa o nome aparado ao Better Auth. */
const validateSignUp = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== '/sign-up/email') {
    return
  }
  return { context: { body: parseSignUpBody(ctx.body) } }
})

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
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    account: {
      // Vínculo implícito só entre provedores que confirmam o e-mail, e só com um usuário cujo
      // e-mail já está verificado (o gate `requireLocalEmailVerified` do Better Auth, padrão
      // ligado): a conta de senha nunca tem o e-mail verificado. Nenhum provedor é "confiável"
      // por nome, e o vínculo manual exige o mesmo e-mail.
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    hooks: { before: validateSignUp },
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
    rateLimit: {
      enabled: true,
      storage: 'database',
      customRules: {
        '/sign-in/email': { ...EMAIL_RATE_LIMITS['/sign-in/email'] },
        '/sign-up/email': { ...EMAIL_RATE_LIMITS['/sign-up/email'] },
      },
    },
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

export function createBetterAuthGateway(db: DrizzleDb, config: BetterAuthConfig): AuthGateway {
  const auth = betterAuth(createBetterAuthOptions(db, config))
  const clearing = clearCookieHeaders(config)
  return {
    methods: authMethodsOf(config),
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
