import { redact } from '@teko/shared/pii'

/**
 * Scrubber dos erros que saem para o PostHog Error Tracking (ADR 0037). O erro reportado é uma
 * cópia, nunca o original: só nome, mensagem e pilha, com
 *
 * - a PII de texto livre trocada pelos marcadores do `PiiRedactor` (`@teko/shared/pii`: e-mail,
 *   CPF, CNPJ, chave de acesso e telefone);
 * - credenciais em URLs (`postgres://usuario:senha@host`) trocadas por `[REDACTED]`;
 * - a mensagem cortada em `MAX_MESSAGE_LENGTH` (uma mensagem longa pode repetir um prompt);
 * - nada da `cause` nem de propriedades próprias do erro (podem carregar a requisição inteira),
 *   menos um `code` técnico (`ECONNRESET`, `57P01`).
 *
 * Valor lançado que não é `Error` não é serializado: vira só o tipo.
 */

export const MAX_MESSAGE_LENGTH = 500
export const REDACTED = '[REDACTED]'

/** `esquema://usuario[:senha]@` → `esquema://[REDACTED]@`. */
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi

/** Código técnico de erro do Node ou do Postgres. */
const ERROR_CODE = /^[A-Z0-9_]{1,64}$/

export function scrubText(text: string): string {
  return redact(text.replace(URL_CREDENTIALS, `$1${REDACTED}@`)).text
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text
}

/** Erro sem PII, pronto para o `captureException`. */
export class ScrubbedError extends Error {
  /** Código técnico do erro original, quando houver. */
  readonly errorCode: string | null

  constructor(name: string, message: string, stack: string | undefined, errorCode: string | null) {
    super(message)
    this.name = name
    this.errorCode = errorCode
    if (stack === undefined) {
      delete this.stack
    } else {
      this.stack = stack
    }
  }
}

function codeOf(error: Error): string | null {
  const code: unknown = (error as { code?: unknown }).code
  return typeof code === 'string' && ERROR_CODE.test(code) ? code : null
}

/** Nome da classe do erro, sem texto livre (`TypeError`, `DatabaseError`). */
function nameOf(error: Error): string {
  return /^[A-Za-z_$][\w$]{0,63}$/.test(error.name) ? error.name : 'Error'
}

export function scrubError(error: unknown): ScrubbedError {
  if (!(error instanceof Error)) {
    return new ScrubbedError('NonErrorThrown', `non-Error value thrown (${typeof error})`, '', null)
  }
  const message = truncate(scrubText(error.message))
  const name = nameOf(error)
  const stack =
    error.stack === undefined
      ? undefined
      : scrubText(error.message === '' ? error.stack : error.stack.replace(error.message, message))
  return new ScrubbedError(name, message, stack, codeOf(error))
}
