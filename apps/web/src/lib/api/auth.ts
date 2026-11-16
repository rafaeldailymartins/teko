import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'
import type { EmailSignInRequest, EmailSignUpRequest } from '@teko/shared/contracts'
import { z } from 'zod'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'

/**
 * Chamadas ao Better Auth (`/api/auth/*`, mesma origem, cookie de sessão): OAuth, e-mail e senha,
 * sair e passkey. Não usam o cliente do
 * Better Auth: as rotas são poucas e estáveis, e o cliente dele com o plugin de passkey somaria
 * ~15 KiB gz ao bundle (design de `add-auth-ui`). Passam pelo `apiClient`, então toda falha HTTP
 * chega como `ApiError`. A cerimônia WebAuthn fica com o `@simplewebauthn/browser` (o mesmo que o
 * plugin de passkey do Better Auth usa), carregado sob demanda no clique.
 */

export const OAuthProvider = {
  GitHub: 'github',
  Google: 'google',
} as const

export type OAuthProvider = (typeof OAuthProvider)[keyof typeof OAuthProvider]

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** Resposta do `POST /sign-in/social`: a URL de autorização do provedor (só http ou https). */
const socialSignInSchema = z.object({ url: z.url({ protocol: /^https?$/ }) })

interface SocialSignInUrls {
  /** Para onde o Better Auth volta depois do login (caminho relativo, já saneado). */
  readonly callbackURL: string
  /** Para onde ele volta com `?error=` quando o login falha. */
  readonly errorCallbackURL: string
}

/** Inicia o OAuth e devolve a URL do provedor; quem chama navega para ela. */
export async function startSocialSignIn(
  provider: OAuthProvider,
  urls: SocialSignInUrls,
): Promise<string> {
  const { data } = await apiClient.post<{ 200: unknown }, unknown, true>({
    url: '/auth/sign-in/social',
    body: { provider, ...urls },
    headers: JSON_HEADERS,
    throwOnError: true,
  })
  return socialSignInSchema.parse(data).url
}

/**
 * Por que a entrada ou o cadastro por e-mail não terminou, para a UI escolher a mensagem (ADR
 * 0036). Nenhuma diz se um e-mail tem conta: a API responde igual nos dois casos.
 */
export const EmailAuthFailure = {
  /** E-mail ou senha não conferem (a mesma resposta para um e-mail sem conta). */
  InvalidCredentials: 'invalidCredentials',
  /**
   * O cadastro respondeu, mas a entrada com a senha escolhida falhou: o e-mail já tinha conta (por
   * senha, GitHub ou Google). A mensagem sugere entrar pelo método de sempre, sem afirmar nada.
   */
  AccountUnavailable: 'accountUnavailable',
  /** Senha com menos de `PASSWORD_MIN_LENGTH` caracteres. */
  PasswordTooShort: 'passwordTooShort',
  /** Senha com mais de `PASSWORD_MAX_LENGTH` caracteres. */
  PasswordTooLong: 'passwordTooLong',
  InvalidEmail: 'invalidEmail',
  /** Nome vazio, longo demais ou com caractere de controle. */
  InvalidName: 'invalidName',
  /** Outro corpo recusado (campo a mais, por exemplo). */
  InvalidInput: 'invalidInput',
  /** Tentativas demais deste IP (5 entradas por minuto, 5 cadastros a cada 10 minutos). */
  RateLimited: 'rateLimited',
} as const

export type EmailAuthFailure = (typeof EmailAuthFailure)[keyof typeof EmailAuthFailure]

export class EmailAuthError extends Error {
  override readonly name = 'EmailAuthError'
  readonly failure: EmailAuthFailure

  constructor(failure: EmailAuthFailure, options?: { readonly cause?: unknown }) {
    super(failure, options)
    this.failure = failure
  }
}

/** Códigos do Better Auth (corpo `{code, message}` dos 400) que a UI distingue. */
const INPUT_FAILURES: Readonly<Record<string, EmailAuthFailure>> = {
  PASSWORD_TOO_SHORT: EmailAuthFailure.PasswordTooShort,
  PASSWORD_TOO_LONG: EmailAuthFailure.PasswordTooLong,
  INVALID_EMAIL: EmailAuthFailure.InvalidEmail,
  INVALID_NAME: EmailAuthFailure.InvalidName,
}

/** Código do corpo de erro do Better Auth, que o `ApiError` guarda em `cause`. */
function betterAuthCode(error: ApiError): string | null {
  const { cause } = error
  return typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
    ? cause.code
    : null
}

/**
 * Falha de e-mail e senha que a UI explica, ou `null` para as outras (rede, 403 de origem, 5xx),
 * que seguem como `ApiError`.
 */
export function emailAuthFailureOf(error: unknown): EmailAuthFailure | null {
  if (!(error instanceof ApiError)) {
    return null
  }
  switch (error.status) {
    case 401:
      return EmailAuthFailure.InvalidCredentials
    case 429:
      return EmailAuthFailure.RateLimited
    case 400:
    case 422:
      return INPUT_FAILURES[betterAuthCode(error) ?? ''] ?? EmailAuthFailure.InvalidInput
    default:
      return null
  }
}

/** Roda a chamada e troca o erro que a UI explica por `EmailAuthError`. */
async function emailCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const failure = emailAuthFailureOf(error)
    throw failure === null ? error : new EmailAuthError(failure, { cause: error })
  }
}

/** Entra com e-mail e senha; o Better Auth grava o cookie de sessão. */
export async function signInWithEmail(credentials: EmailSignInRequest): Promise<void> {
  await emailCall(() =>
    apiClient.post<{ 200: unknown }, unknown, true>({
      url: '/auth/sign-in/email',
      body: { email: credentials.email, password: credentials.password },
      headers: JSON_HEADERS,
      throwOnError: true,
    }),
  )
}

/**
 * Cria a conta por e-mail e senha e entra nela. O cadastro nunca abre sessão e responde igual
 * para um e-mail que já tem conta (proteção contra enumeração): a sessão vem da entrada logo
 * depois, e uma entrada recusada ali vira `accountUnavailable`.
 */
export async function signUpWithEmail(account: EmailSignUpRequest): Promise<void> {
  await emailCall(() =>
    apiClient.post<{ 200: unknown }, unknown, true>({
      url: '/auth/sign-up/email',
      body: { name: account.name, email: account.email, password: account.password },
      headers: JSON_HEADERS,
      throwOnError: true,
    }),
  )
  try {
    await signInWithEmail({ email: account.email, password: account.password })
  } catch (error) {
    if (error instanceof EmailAuthError && error.failure === EmailAuthFailure.InvalidCredentials) {
      throw new EmailAuthError(EmailAuthFailure.AccountUnavailable, { cause: error })
    }
    throw error
  }
}

/** Encerra a sessão: o Better Auth apaga o cookie e revoga a sessão no banco. */
export async function signOut(): Promise<void> {
  await apiClient.post<{ 200: unknown }, unknown, true>({
    url: '/auth/sign-out',
    body: {},
    headers: JSON_HEADERS,
    throwOnError: true,
  })
}

/** Por que uma operação de passkey não terminou, para a UI escolher a mensagem. */
export const PasskeyFailure = {
  /** O usuário fechou ou recusou o diálogo do navegador (ou o tempo acabou). */
  Cancelled: 'cancelled',
  /** O navegador não tem WebAuthn. */
  Unsupported: 'unsupported',
  /** Este autenticador já tem uma passkey da conta. */
  AlreadyRegistered: 'alreadyRegistered',
  /** Cadastrar exige uma sessão recente (o Better Auth recusa a de mais de um dia). */
  Reauthenticate: 'reauthenticate',
  /** Qualquer outra falha do autenticador. */
  Failed: 'failed',
} as const

export type PasskeyFailure = (typeof PasskeyFailure)[keyof typeof PasskeyFailure]

export class PasskeyError extends Error {
  override readonly name = 'PasskeyError'
  readonly failure: PasskeyFailure

  constructor(failure: PasskeyFailure, options?: { readonly cause?: unknown }) {
    super(failure, options)
    this.failure = failure
  }
}

const CANCELLED_NAMES: ReadonlySet<string> = new Set(['NotAllowedError', 'AbortError'])

/** Falha lançada pela cerimônia no navegador (`WebAuthnError` ou `DOMException`). */
export function passkeyFailureOf(error: unknown): PasskeyFailure {
  if (!(error instanceof Error)) {
    return PasskeyFailure.Failed
  }
  const code = 'code' in error ? error.code : undefined
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return PasskeyFailure.AlreadyRegistered
  }
  if (code === 'ERROR_CEREMONY_ABORTED' || CANCELLED_NAMES.has(error.name)) {
    return PasskeyFailure.Cancelled
  }
  return PasskeyFailure.Failed
}

/** Se o navegador tem WebAuthn (o mesmo teste do `browserSupportsWebAuthn`, sem carregar a lib). */
export function supportsPasskeys(scope: object = globalThis): boolean {
  return 'PublicKeyCredential' in scope && typeof scope.PublicKeyCredential === 'function'
}

function loadWebAuthn() {
  return import('@simplewebauthn/browser')
}

/** Roda a cerimônia do navegador e traduz a falha dela em `PasskeyError`. */
async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new PasskeyError(passkeyFailureOf(error), { cause: error })
  }
}

/** Entra com uma passkey já cadastrada (cria a sessão por cookie). */
export async function signInWithPasskey(): Promise<void> {
  if (!supportsPasskeys()) {
    throw new PasskeyError(PasskeyFailure.Unsupported)
  }
  const { startAuthentication } = await loadWebAuthn()
  const { data } = await apiClient.get<
    { 200: PublicKeyCredentialRequestOptionsJSON },
    unknown,
    true
  >({ url: '/auth/passkey/generate-authenticate-options', throwOnError: true })
  const { clientExtensionResults: _extensions, ...response } = await ceremony(() =>
    startAuthentication({ optionsJSON: data }),
  )
  await apiClient.post<{ 200: unknown }, unknown, true>({
    url: '/auth/passkey/verify-authentication',
    body: { response },
    headers: JSON_HEADERS,
    throwOnError: true,
  })
}

/** Cadastra uma passkey na conta da sessão (exige sessão recente). */
export async function registerPasskey(name?: string): Promise<void> {
  if (!supportsPasskeys()) {
    throw new PasskeyError(PasskeyFailure.Unsupported)
  }
  const { startRegistration } = await loadWebAuthn()
  const label = name?.trim() ?? ''
  let options: PublicKeyCredentialCreationOptionsJSON
  try {
    const result = await apiClient.get<
      { 200: PublicKeyCredentialCreationOptionsJSON },
      unknown,
      true
    >({
      url: '/auth/passkey/generate-register-options',
      ...(label === '' ? {} : { query: { name: label } }),
      throwOnError: true,
    })
    options = result.data
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new PasskeyError(PasskeyFailure.Reauthenticate, { cause: error })
    }
    throw error
  }
  const { clientExtensionResults: _extensions, ...response } = await ceremony(() =>
    startRegistration({ optionsJSON: options }),
  )
  await apiClient.post<{ 200: unknown }, unknown, true>({
    url: '/auth/passkey/verify-registration',
    body: label === '' ? { response } : { response, name: label },
    headers: JSON_HEADERS,
    throwOnError: true,
  })
}

/** Passkey cadastrada, só os campos que a tela usa. */
const passkeySchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  createdAt: z.coerce.date(),
  deviceType: z.string().nullish(),
})

export type Passkey = z.infer<typeof passkeySchema>

const passkeyListSchema = z.array(passkeySchema)

export async function listPasskeys(): Promise<Passkey[]> {
  const { data } = await apiClient.get<{ 200: unknown }, unknown, true>({
    url: '/auth/passkey/list-user-passkeys',
    throwOnError: true,
  })
  return passkeyListSchema.parse(data)
}

export async function deletePasskey(id: string): Promise<void> {
  await apiClient.post<{ 200: unknown }, unknown, true>({
    url: '/auth/passkey/delete-passkey',
    body: { id },
    headers: JSON_HEADERS,
    throwOnError: true,
  })
}
