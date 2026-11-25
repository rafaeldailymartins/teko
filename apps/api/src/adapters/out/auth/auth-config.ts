import { AuthMethod } from '@teko/shared/contracts'

/**
 * Configuração do Better Auth e o que a porta `AuthGateway` responde sem carregar o SDK: os
 * métodos de entrada e os `Set-Cookie` que apagam a sessão. O SDK (`better-auth.ts`) só entra na
 * primeira requisição que precisa dele (`lazy-better-auth.ts`).
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

/** Métodos de entrada ativos, na ordem da tela. */
export function authMethodsOf(config: Pick<BetterAuthConfig, 'github' | 'google'>): AuthMethod[] {
  return [
    ...(config.github === null ? [] : [AuthMethod.GitHub]),
    ...(config.google === null ? [] : [AuthMethod.Google]),
    AuthMethod.Passkey,
    AuthMethod.Email,
  ]
}

/** Cookies que o Better Auth grava para a sessão (com o prefixo e, em https, `__Secure-`). */
const SESSION_COOKIES = ['session_token', 'session_data', 'dont_remember'] as const

export function clearCookieHeaders(
  config: Pick<BetterAuthConfig, 'cookiePrefix' | 'webOrigin'>,
): string[] {
  const secure = config.webOrigin.startsWith('https://')
  return SESSION_COOKIES.map(
    (name) =>
      `${secure ? '__Secure-' : ''}${config.cookiePrefix}.${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
  )
}
