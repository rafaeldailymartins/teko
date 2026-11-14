/**
 * Autenticação (Better Auth na F4): o handler de `/api/auth/*` e a leitura da sessão. O adapter de
 * entrada HTTP só conhece esta porta; a configuração do Better Auth fica em `adapters/out/auth`.
 */

/** Usuário da sessão, com os campos do onboarding. */
export interface SessionUser {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
  readonly isAdult: boolean
  readonly termsVersion: string | null
  readonly termsAcceptedAt: Date | null
  readonly countryOfResidence: string | null
}

export interface AuthSession {
  readonly sessionId: string
  readonly expiresAt: Date
  readonly user: SessionUser
}

export interface GetSessionOptions {
  /**
   * Lê a sessão do banco, ignorando o `cookieCache` de 5 min: as rotas de DSR (`DELETE /me` e
   * `GET /me/export`) nunca confiam numa sessão que pode ter sido revogada.
   */
  readonly fresh?: boolean
}

export interface AuthGateway {
  /** Atende uma requisição de `/api/auth/*` (Fetch API). */
  handle(request: Request): Promise<Response>
  /** Sessão do cookie, ou `null` sem sessão válida. */
  getSession(headers: Headers, options?: GetSessionOptions): Promise<AuthSession | null>
  /** `Set-Cookie` que apagam os cookies de sessão no navegador (depois de `DELETE /me`). */
  clearSessionCookies(): readonly string[]
}

/** Header interno com o IP do cliente resolvido pela porta `ClientIp` (rate limit do Better Auth). */
export const CLIENT_IP_HEADER = 'x-teko-client-ip'
