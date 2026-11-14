import {
  createProblem,
  ErrorCode,
  type FieldError,
  type ProblemDetails,
  type ProblemInit,
} from '@teko/shared/errors'
import {
  hasZodFastifySchemaValidationErrors,
  ResponseSerializationError,
} from 'fastify-type-provider-zod'
import { ApplicationError } from '#app/errors.ts'

/**
 * Converte qualquer erro lançado no ciclo de vida da requisição em Problem Details (RFC 9457).
 *
 * Regras:
 * - `ApplicationError` → o código e os dados que a aplicação escolheu (`onboarding_required`,
 *   `quota_exceeded` com `meta`, `stream_busy`...);
 * - validação Zod de entrada → 400 `validation_error` com `errors[]` por campo;
 * - resposta que não bate com o schema → 500 `internal` (bug nosso, nunca do cliente);
 * - erros HTTP 4xx (Fastify, plugins, `@fastify/sensible`) → código pelo status; os demais 4xx
 *   (413 corpo grande, 415 content-type, JSON inválido...) viram `validation_error` com o status
 *   original; 429 (`@fastify/rate-limit`) → `rate_limited`;
 * - 503 (`under-pressure`) → `service_paused`;
 * - qualquer outra coisa → 500 `internal`, sem `detail`: mensagens internas nunca vazam.
 */

export interface ProblemContext {
  /** Request id (vira o `traceId` exibido na UI como "ID de suporte"). */
  readonly traceId: string
  /** Caminho da requisição, sem query string (RFC 9457 `instance`). */
  readonly instance?: string
}

interface HttpErrorLike {
  readonly statusCode: number
  readonly code?: unknown
  readonly message?: unknown
  readonly expose?: unknown
}

const TOO_MANY_REQUESTS = 429
const SERVICE_UNAVAILABLE = 503

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return false
  }
  const { statusCode } = error
  return typeof statusCode === 'number' && Number.isInteger(statusCode)
}

/**
 * Só mensagens que sabidamente são seguras para o cliente viram `detail`: as do próprio Fastify
 * (`FST_*`, ex.: "Request body is too large") e as de `http-errors` marcadas com `expose`.
 */
function safeDetail(error: HttpErrorLike): string | undefined {
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  if (message === '') {
    return undefined
  }
  const isFastifyError = typeof error.code === 'string' && error.code.startsWith('FST_')
  return isFastifyError || error.expose === true ? message : undefined
}

function withContext<T extends ProblemInit>(init: T, context: ProblemContext): T {
  return context.instance === undefined ? init : { ...init, instance: context.instance }
}

function withDetail<T extends ProblemInit>(init: T, detail: string | undefined): T {
  return detail === undefined ? init : { ...init, detail }
}

/** `/families/0` (JSON Pointer do Fastify) → `families.0`; vazio = o corpo inteiro. */
export function instancePathToFieldPath(instancePath: string): string {
  return instancePath
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .join('.')
}

function clientErrorInit(status: number, traceId: string): ProblemInit {
  switch (status) {
    case 401:
      return { code: ErrorCode.Unauthenticated, traceId }
    case 403:
      return { code: ErrorCode.Forbidden, traceId }
    case 404:
      return { code: ErrorCode.NotFound, traceId }
    case 451:
      return { code: ErrorCode.RegionRestricted, traceId }
    case TOO_MANY_REQUESTS:
      // Rate limit HTTP (`@fastify/rate-limit`), não a cota diária: `quota_exceeded` exige
      // `meta.scope`/`resetAt` e é emitido só pelo `QuotaGuard`. O `Retry-After` já foi gravado
      // pelo plugin.
      return {
        code: ErrorCode.RateLimited,
        traceId,
        detail: 'Too many requests; retry after the time in the Retry-After header',
      }
    default:
      return { code: ErrorCode.ValidationError, traceId, status }
  }
}

export function problemFromError(error: unknown, context: ProblemContext): ProblemDetails {
  const { traceId } = context

  if (error instanceof ApplicationError) {
    return createProblem(withContext({ ...error.problem, traceId }, context))
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    const errors: FieldError[] = error.validation.map((issue) => ({
      path: instancePathToFieldPath(issue.instancePath),
      message: issue.message ?? 'Invalid value',
    }))
    const where = error.validationContext ?? 'request'
    return createProblem(
      withContext(
        { code: ErrorCode.ValidationError, traceId, detail: `Invalid ${where}`, errors },
        context,
      ),
    )
  }

  // `isResponseSerializationError` da lib só testa `'method' in value` (e lança com primitivos).
  if (error instanceof ResponseSerializationError || !isHttpErrorLike(error)) {
    return createProblem(withContext({ code: ErrorCode.Internal, traceId }, context))
  }

  const { statusCode } = error
  if (statusCode === SERVICE_UNAVAILABLE) {
    return createProblem(withContext({ code: ErrorCode.ServicePaused, traceId }, context))
  }
  if (statusCode < 400 || statusCode > 499) {
    return createProblem(withContext({ code: ErrorCode.Internal, traceId }, context))
  }

  const init = clientErrorInit(statusCode, traceId)
  const detailed = init.detail === undefined ? withDetail(init, safeDetail(error)) : init
  return createProblem(withContext(detailed, context))
}

/** 404 de rota inexistente (não passa pelo error handler do Fastify). */
export function notFoundProblem(method: string, context: ProblemContext): ProblemDetails {
  const route = context.instance ?? ''
  return createProblem(
    withContext(
      {
        code: ErrorCode.NotFound,
        traceId: context.traceId,
        detail: `Route ${method} ${route} not found`,
      },
      context,
    ),
  )
}
