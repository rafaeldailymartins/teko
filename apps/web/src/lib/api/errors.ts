import {
  ErrorCode,
  isProblemDetails,
  isRetryable,
  type ProblemDetails,
  type QuotaExceededMeta,
} from '@teko/shared/errors'
import { traceIdOf } from './trace.ts'

/**
 * Erro tipado da camada de dados. Toda falha do cliente gerado chega à UI como `ApiError` (o
 * interceptor de erro em `client.ts` converte), com um `code` do conjunto fechado de
 * `@teko/shared/errors`, que a UI traduz por `errors.<code>` no next-intl (`messageKey`).
 *
 * - Problem Details (RFC 9457) válido: `code`, `traceId` ("ID de suporte") e `meta`/`errors` vêm do
 *   corpo; `retryable` segue `ERROR_CODE_SPECS`.
 * - Resposta de erro sem problem+json (proxy, 502 da plataforma): o código sai do status HTTP.
 * - Falha de rede (sem resposta): `internal`, repetível, `status: null`.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly code: ErrorCode
  readonly status: number | null
  readonly retryable: boolean
  /**
   * "ID de suporte": o `traceId` do problem+json ou, sem ele, o header `x-trace-id` da resposta
   * (o mesmo `trace_id` do trace da requisição na API); `null` sem resposta.
   */
  readonly traceId: string | null
  /** Só em `quota_exceeded`: escopo e horário de reset. */
  readonly quota: QuotaExceededMeta | null
  readonly problem: ProblemDetails | null

  constructor(init: {
    readonly code: ErrorCode
    readonly status: number | null
    readonly problem?: ProblemDetails
    readonly traceId?: string | null
    readonly cause?: unknown
  }) {
    super(init.problem?.detail ?? init.problem?.title ?? init.code, { cause: init.cause })
    this.code = init.code
    this.status = init.status
    this.retryable = isRetryable(init.code)
    this.problem = init.problem ?? null
    this.traceId = init.problem?.traceId ?? init.traceId ?? null
    this.quota = init.problem?.code === ErrorCode.QuotaExceeded ? init.problem.meta : null
  }

  /** Chave do next-intl com a mensagem do erro (`t(error.messageKey)`). */
  get messageKey(): `errors.${ErrorCode}` {
    return `errors.${this.code}`
  }
}

/** Código para uma resposta de erro que não trouxe problem+json válido. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 413:
    case 415:
    case 422:
      return ErrorCode.ValidationError
    case 401:
      return ErrorCode.Unauthenticated
    case 403:
      return ErrorCode.Forbidden
    case 404:
      return ErrorCode.NotFound
    case 409:
      return ErrorCode.StreamBusy
    case 429:
      return ErrorCode.RateLimited
    case 451:
      return ErrorCode.RegionRestricted
    case 503:
      return ErrorCode.ServicePaused
    default:
      return ErrorCode.Internal
  }
}

/**
 * Converte o que o cliente gerado lança (corpo de erro já lido como JSON ou texto, ou a exceção
 * do `fetch`) em `ApiError`. `response` ausente = a requisição nem chegou a ter resposta.
 */
export function toApiError(error: unknown, response: Response | undefined): ApiError {
  if (error instanceof ApiError) {
    return error
  }
  if (response === undefined) {
    return new ApiError({ code: ErrorCode.Internal, status: null, cause: error })
  }
  const traceId = traceIdOf(response)
  if (isProblemDetails(error)) {
    return new ApiError({ code: error.code, status: response.status, problem: error, traceId })
  }
  return new ApiError({
    code: errorCodeForStatus(response.status),
    status: response.status,
    traceId,
    cause: error,
  })
}
