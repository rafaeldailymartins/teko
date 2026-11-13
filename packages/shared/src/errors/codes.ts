/**
 * Conjunto fechado de códigos de erro da API (campo `code` do problem+json e do chunk `error`
 * do stream). A web tem uma chave de i18n `errors.<code>` para cada um.
 *
 * Os códigos do plano (sem `ticket_invalid` e `ticket_reused`, que saíram com o ticket do stream na
 * ADR 0029: um segundo stream da mesma pergunta é `stream_busy`), mais três: `forbidden` e
 * `not_found` cobrem respostas que a superfície HTTP já prevê (403 de `Origin` recusada, 404 de
 * pergunta/dispositivo inexistente e de rotas de eval fora do CI) e que nenhum dos outros códigos
 * descreve; `rate_limited` é o 429 do
 * `@fastify/rate-limit` (janela curta, com `Retry-After`), distinto da cota diária
 * (`quota_exceeded`, que exige `meta.scope` e `resetAt`).
 */
export const ErrorCode = {
  ValidationError: 'validation_error',
  Unauthenticated: 'unauthenticated',
  Forbidden: 'forbidden',
  NotFound: 'not_found',
  OnboardingRequired: 'onboarding_required',
  QuotaExceeded: 'quota_exceeded',
  RateLimited: 'rate_limited',
  ServicePaused: 'service_paused',
  StreamBusy: 'stream_busy',
  UpstreamUnavailable: 'upstream_unavailable',
  RegionRestricted: 'region_restricted',
  Internal: 'internal',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export const ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode)

interface ErrorCodeSpec {
  /** Status HTTP padrão do código. */
  readonly status: number
  /** Resumo curto e estável (RFC 9457 `title`); o texto localizado fica na web. */
  readonly title: string
  /** O cliente pode repetir a mesma operação mais tarde e ter sucesso. */
  readonly retryable: boolean
}

export const ERROR_CODE_SPECS: Readonly<Record<ErrorCode, ErrorCodeSpec>> = {
  validation_error: { status: 400, title: 'Invalid request', retryable: false },
  unauthenticated: { status: 401, title: 'Authentication required', retryable: false },
  forbidden: { status: 403, title: 'Forbidden', retryable: false },
  not_found: { status: 404, title: 'Not found', retryable: false },
  onboarding_required: { status: 403, title: 'Onboarding required', retryable: false },
  quota_exceeded: { status: 429, title: 'Daily quota exceeded', retryable: true },
  rate_limited: { status: 429, title: 'Too many requests', retryable: true },
  service_paused: { status: 503, title: 'Service paused', retryable: true },
  stream_busy: { status: 409, title: 'Another answer is already streaming', retryable: true },
  upstream_unavailable: { status: 503, title: 'Upstream provider unavailable', retryable: true },
  region_restricted: {
    status: 451,
    title: 'Unavailable in your region',
    retryable: false,
  },
  internal: { status: 500, title: 'Internal error', retryable: true },
}

/** Escopo de `quota_exceeded` (`meta.scope`). */
export const QuotaScope = {
  UserDaily: 'user_daily',
  GlobalDaily: 'global_daily',
} as const

export type QuotaScope = (typeof QuotaScope)[keyof typeof QuotaScope]

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CODE_SPECS, value)
}

export function httpStatusOf(code: ErrorCode): number {
  return ERROR_CODE_SPECS[code].status
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODE_SPECS[code].retryable
}
