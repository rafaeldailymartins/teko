import { parseStreamError } from '@teko/shared/contracts'
import { ErrorCode, isErrorCode, isRetryable } from '@teko/shared/errors'
import { ApiError } from '../api/errors.ts'

/**
 * Falha do chat a partir do `error` do `useChat`: um `ApiError` (o `POST /questions` ou a abertura
 * do stream falhou) ou o `errorText` do chunk `error` (`{code, retryable}` em JSON). Qualquer outra
 * coisa (rede, chunk inválido) é `internal`. O "ID de suporte" é o do `ApiError` ou, para o chunk
 * `error`, o `x-trace-id` do stream (`streamTraceId`, guardado pelo transporte).
 */
export interface ChatFailure {
  readonly code: ErrorCode
  readonly retryable: boolean
  /** Reset da cota, quando a API informou (`quota_exceeded`). */
  readonly resetAt: string | null
  /** "ID de suporte" (`trace_id` da requisição na API), quando houve resposta. */
  readonly traceId: string | null
}

export function chatFailure(
  error: Error | undefined,
  streamTraceId: string | null = null,
): ChatFailure | null {
  if (error === undefined) return null
  if (error instanceof ApiError) {
    return {
      code: error.code,
      retryable: error.retryable,
      resetAt: error.quota?.resetAt ?? null,
      traceId: error.traceId,
    }
  }
  const streamError = parseStreamError(error.message)
  if (streamError !== null && isErrorCode(streamError.code)) {
    return {
      code: streamError.code,
      retryable: streamError.retryable,
      resetAt: null,
      traceId: streamTraceId,
    }
  }
  return {
    code: ErrorCode.Internal,
    retryable: isRetryable(ErrorCode.Internal),
    resetAt: null,
    traceId: streamTraceId,
  }
}

/** Cota estourada e serviço pausado desabilitam o composer até o reset. */
export function blocksComposer(failure: ChatFailure | null): boolean {
  return failure?.code === ErrorCode.QuotaExceeded || failure?.code === ErrorCode.ServicePaused
}
