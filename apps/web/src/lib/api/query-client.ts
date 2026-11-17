import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ErrorCode } from '@teko/shared/errors'
import { errorCapture } from '../analytics/errors.ts'
import { ApiError } from './errors.ts'

declare module '@tanstack/react-query' {
  /** Erro padrão de toda consulta e mutação: o interceptor de `client.ts` só lança `ApiError`. */
  interface Register {
    defaultError: ApiError
  }
}

/** Dados do corpus e da conta mudam pouco: 1 min de cache fresco evita refetch a cada foco. */
export const STALE_TIME_MS = 60_000

/** Tentativas extras de uma consulta que falhou com erro repetível. */
const MAX_RETRIES = 2

/**
 * Repetir só faz sentido quando a falha é transitória e pode passar em segundos. Cota diária e
 * rate limit também são `retryable` (passam mais tarde), mas repetir na hora só gasta a janela:
 * a UI mostra o reset em vez disso.
 */
const NOT_RETRIED_NOW: ReadonlySet<ErrorCode> = new Set([
  ErrorCode.QuotaExceeded,
  ErrorCode.RateLimited,
])

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return (
    failureCount < MAX_RETRIES &&
    error instanceof ApiError &&
    error.retryable &&
    !NOT_RETRIED_NOW.has(error.code)
  )
}

/**
 * Falha que vale reportar ao Error Tracking: um 500 `internal` que a API devolveu (com o `trace_id`
 * dela). Falha de rede (sem status), validação, sessão, cota e os 503 deliberados ficam de fora:
 * são esperados, e a UI já os trata.
 */
export function isUnexpectedApiError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === ErrorCode.Internal && error.status !== null
}

/** Destino dos erros inesperados das consultas e mutações (padrão: a captura do app). */
export type ReportError = (error: unknown) => void

/** Um `QueryClient` por árvore do navegador (o export estático não renderiza dados no servidor). */
export function createQueryClient(reportError: ReportError = errorCapture.report): QueryClient {
  const onError = (error: unknown): void => {
    if (isUnexpectedApiError(error)) {
      reportError(error)
    }
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { staleTime: STALE_TIME_MS, retry: shouldRetry },
      mutations: { retry: false },
    },
  })
}
