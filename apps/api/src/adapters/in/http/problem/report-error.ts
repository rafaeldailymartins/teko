import type { BackgroundTasks } from '#app/ports/background-tasks.ts'
import type { ErrorReporterPort } from '#app/ports/error-reporter.ts'
import type { UnexpectedErrorHook } from './error-handler.ts'

/** Teto do envio do erro depois da resposta (`waitUntil` na Vercel), o mesmo da telemetria. */
export const ERROR_FLUSH_TIMEOUT_MS = 500

export interface ErrorReportingDeps {
  readonly errorReporter: ErrorReporterPort
  readonly backgroundTasks: BackgroundTasks
}

/**
 * Liga o error handler ao destino de erros (`docs/architecture/observabilidade.md`, "Erros"): cada
 * erro inesperado (`internal`) vai ao `ErrorReporterPort` com o `trace_id`, o método, a rota
 * declarada e o status, e o
 * envio entra em `BackgroundTasks` com teto de 500 ms. Sem destino configurado (no-op), nem o
 * flush é agendado: requisição sem erro nunca paga nada.
 */
export function reportUnexpectedErrors({
  errorReporter,
  backgroundTasks,
}: ErrorReportingDeps): UnexpectedErrorHook {
  return (error, request, status) => {
    if (!errorReporter.enabled) {
      return
    }
    errorReporter.report(error, {
      // Antes do hook de telemetria (erro no parse da requisição), o request id faz as vezes.
      traceId: request.traceId || request.id,
      method: request.method,
      route: request.routeOptions.url ?? null,
      statusCode: status,
    })
    backgroundTasks.run('error-flush', errorReporter.flush(), {
      timeoutMs: ERROR_FLUSH_TIMEOUT_MS,
    })
  }
}
