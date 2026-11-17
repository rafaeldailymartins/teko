/**
 * Destino dos erros inesperados da API (PostHog Error Tracking, ADR 0037). A aplicação e o adapter
 * HTTP só conhecem esta porta; o SDK fica em `adapters/out/error-reporting`. Sem a chave do projeto,
 * a raiz de composição usa `noopErrorReporter`.
 *
 * - `report` é síncrono e nunca lança: só enfileira o evento, já sem PII.
 * - `flush` exporta a fila e nunca rejeita; quem chama o põe em `BackgroundTasks` (teto de 500 ms),
 *   e só quando houve um `report` na requisição.
 */

/** Contexto técnico de um erro numa requisição HTTP (nada do corpo, da pergunta, do e-mail ou do IP). */
export interface ErrorReportContext {
  /** `trace_id` W3C da requisição (o mesmo do `x-trace-id` e do "ID de suporte"). */
  readonly traceId: string
  readonly method: string
  /** Rota declarada (`/api/v1/questions/:id/stream`), nunca a URL com IDs; `null` sem rota. */
  readonly route: string | null
  readonly statusCode: number
}

export interface ErrorReporterPort {
  /** `false` no no-op: o chamador nem agenda o flush. */
  readonly enabled: boolean
  report(error: unknown, context: ErrorReportContext): void
  flush(): Promise<void>
  /** Exporta o que sobrou e libera o cliente (encerramento gracioso). Nunca rejeita. */
  shutdown(timeoutMs: number): Promise<void>
}

export const noopErrorReporter: ErrorReporterPort = {
  enabled: false,
  report: () => {},
  flush: async () => {},
  shutdown: async () => {},
}
