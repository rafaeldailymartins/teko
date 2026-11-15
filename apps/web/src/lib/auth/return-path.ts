import type { Locale } from '@teko/shared/i18n'
import { localePagePath } from '../navigation.ts'

/**
 * Retorno seguro depois do login. O destino chega pela query (`?callbackURL=`) e vai para o Better
 * Auth, que redireciona para ele no fim do OAuth: só caminhos da própria origem passam, nunca uma
 * URL absoluta, `//host`, barra invertida, caractere de controle ou separador codificado no caminho
 * (as mesmas recusas do `isSafeRelativeURL` do Better Auth, que confere de novo no servidor).
 */

/** Nome do parâmetro de retorno na query do sign-in (o mesmo nome do Better Auth). */
export const RETURN_PARAM = 'callbackURL'

/** Parâmetro com o código de erro que o Better Auth anexa ao `errorCallbackURL`. */
export const ERROR_PARAM = 'error'

/** Teto do caminho de retorno: o Better Auth guarda o destino no estado do OAuth. */
const MAX_RETURN_LENGTH = 1024

/** Origem fictícia só para resolver o caminho relativo e ver se ele sai da origem. */
const PARSER_ORIGIN = 'https://teko.invalid'

const ENCODED_SEPARATOR = /%2f|%5c/i

/** Caracteres de controle C0, DEL e C1 (U+0000 a U+001F e U+007F a U+009F). */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      return true
    }
  }
  return false
}

/** Destino quando o retorno falta ou não é seguro: o chat do idioma atual. */
export function defaultReturnPath(locale: Locale): string {
  return localePagePath(locale, 'chat')
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length > MAX_RETURN_LENGTH ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    hasControlCharacter(value)
  ) {
    return false
  }
  const pathEnd = value.search(/[?#]/)
  const path = pathEnd === -1 ? value : value.slice(0, pathEnd)
  if (ENCODED_SEPARATOR.test(path)) {
    return false
  }
  try {
    return new URL(value, PARSER_ORIGIN).origin === PARSER_ORIGIN
  } catch {
    return false
  }
}

/** A página de entrada não é destino de retorno (laço); `/api/` também não (não é página). */
function isPageDestination(value: string): boolean {
  const path = new URL(value, PARSER_ORIGIN).pathname
  return !path.startsWith('/api/') && !/^\/[^/]+\/sign-in(\/|$)/.test(path)
}

/**
 * Caminho de retorno saneado: o valor recebido se for um caminho seguro de uma página da própria
 * origem; senão, o chat do idioma atual.
 */
export function safeReturnPath(raw: string | null | undefined, locale: Locale): string {
  if (typeof raw !== 'string' || !isSafeRelativePath(raw) || !isPageDestination(raw)) {
    return defaultReturnPath(locale)
  }
  return raw
}

/** Caminho e query da página atual, para voltar a ela depois do login. */
export function currentReturnPath(location: Pick<Location, 'pathname' | 'search'>): string {
  return `${location.pathname}${location.search}`
}

/** Página de entrada com o retorno (saneado) na query. */
export function signInPath(locale: Locale, returnTo?: string): string {
  const base = localePagePath(locale, 'sign-in')
  if (returnTo === undefined) {
    return base
  }
  const query = new URLSearchParams({ [RETURN_PARAM]: safeReturnPath(returnTo, locale) })
  return `${base}?${query.toString()}`
}

/** Código de erro da própria API que a página de entrada também mostra (aviso de região). */
const REGION_RESTRICTED = 'region_restricted'

/**
 * Página de aviso de região (`region_restricted`): a página de entrada com o código no `?error=`.
 * A conversa leva para cá quando a API recusa a pergunta por política regional.
 */
export function regionRestrictedPath(locale: Locale): string {
  const query = new URLSearchParams({ [ERROR_PARAM]: REGION_RESTRICTED })
  return `${localePagePath(locale, 'sign-in')}?${query.toString()}`
}

/** Erros da entrada que a página distingue; o resto vira a mensagem genérica. */
export const SignInError = {
  Cancelled: 'cancelled',
  Blocked: 'blocked',
  AccountNotLinked: 'accountNotLinked',
  EmailMissing: 'emailMissing',
  RegionRestricted: 'regionRestricted',
  Generic: 'generic',
} as const

export type SignInError = (typeof SignInError)[keyof typeof SignInError]

/**
 * Códigos do `?error=` (os do callback OAuth do Better Auth, o `access_denied` do provedor e o
 * `region_restricted` da API) agrupados no que a página mostra.
 */
const SIGN_IN_ERRORS: ReadonlyMap<string, SignInError> = new Map([
  ['access_denied', SignInError.Cancelled],
  ['banned', SignInError.Blocked],
  ['user_banned', SignInError.Blocked],
  ['account_blocked', SignInError.Blocked],
  ['account_not_linked', SignInError.AccountNotLinked],
  ['unable_to_link_account', SignInError.AccountNotLinked],
  ['account_already_linked_to_different_user', SignInError.AccountNotLinked],
  ['email_not_found', SignInError.EmailMissing],
  [REGION_RESTRICTED, SignInError.RegionRestricted],
])

/** Erro a mostrar para o `?error=` da página de entrada; `null` quando não há erro. */
export function signInErrorOf(code: string | null | undefined): SignInError | null {
  if (typeof code !== 'string' || code === '') {
    return null
  }
  return SIGN_IN_ERRORS.get(code) ?? SignInError.Generic
}
