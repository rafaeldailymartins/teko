import { parseStreamError } from '@teko/shared/contracts'
import { ErrorCode, isErrorCode, isRetryable } from '@teko/shared/errors'
import { ApiError } from '../api/errors.ts'

/**
 * Falha do chat a partir do `error` do `useChat`: um `ApiError` (o `POST /questions` ou a abertura
 * do stream falhou) ou o `errorText` do chunk `error` (`{code, retryable}` em JSON). Qualquer outra
 * coisa (rede, chunk inválido) é `internal`.
 */
export interface ChatFailure {
  readonly code: ErrorCode
  readonly retryable: boolean
  /** Reset da cota, quando a API informou (`quota_exceeded`). */
  readonly resetAt: string | null
}

export function chatFailure(error: Error | undefined): ChatFailure | null {
  if (error === undefined) return null
  if (error instanceof ApiError) {
    return { code: error.code, retryable: error.retryable, resetAt: error.quota?.resetAt ?? null }
  }
  const streamError = parseStreamError(error.message)
  if (streamError !== null && isErrorCode(streamError.code)) {
    return { code: streamError.code, retryable: streamError.retryable, resetAt: null }
  }
  return { code: ErrorCode.Internal, retryable: isRetryable(ErrorCode.Internal), resetAt: null }
}

/** Cota estourada e serviço pausado desabilitam o composer até o reset. */
export function blocksComposer(failure: ChatFailure | null): boolean {
  return failure?.code === ErrorCode.QuotaExceeded || failure?.code === ErrorCode.ServicePaused
}
