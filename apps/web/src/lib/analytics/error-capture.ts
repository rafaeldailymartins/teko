/**
 * Captura de erros do navegador para o PostHog Error Tracking (ADR 0037). Fica no primeiro
 * carregamento, mas é só um handler: o SDK entra por `import()` (`loadErrorClient`) quando o
 * primeiro erro acontece, nunca antes. Regras, que seguem a política publicada (erros são
 * legítimo interesse e não gravam nada no navegador):
 *
 * - não depende do consentimento de analytics, e o cliente carregado não persiste nada
 *   (`persistence: 'memory'`, sem `identify`, pageview nem autocapture; `posthog-config.ts`);
 * - sem a chave pública dos erros no build (`NEXT_PUBLIC_POSTHOG_ERRORS_KEY`), nada é instalado;
 * - o erro já ocorrido sai com a própria pilha (`captureException(error)`), mais o release do
 *   build e, quando vem de uma resposta da API (`ApiError`), o `trace_id` dela;
 * - no máximo `MAX_ERRORS_PER_PAGE` por página e o mesmo erro uma vez só (um erro em laço não
 *   vira uma rajada); falha ao carregar o cliente desliga a captura, sem derrubar a página.
 */

/** O que acompanha a exceção (nada de texto livre). */
export interface ErrorProperties {
  readonly trace_id?: string
  readonly release?: string
}

/** Cliente carregado sob demanda (`error-client.ts`). */
export interface ErrorClient {
  capture(error: unknown, properties: ErrorProperties): void
}

export type ErrorClientLoader = (key: string) => Promise<ErrorClient>

export interface ErrorCaptureOptions {
  /** Chave pública do projeto; ausente, a captura fica desligada. */
  readonly key: string | undefined
  /** Release do build (`teko@X.Y.Z` ou `teko@<sha7>`). */
  readonly release: string | undefined
  readonly load: ErrorClientLoader
}

/** O pedaço do `window` que a captura escuta (o teste passa um `EventTarget`). */
type ErrorEventTarget = Pick<EventTarget, 'addEventListener'>

export interface ErrorCapture {
  /** Reporta um erro (de um `ErrorBoundary`, de uma consulta que falhou com 500...). */
  report(error: unknown): void
  /** Escuta `error` e `unhandledrejection` da janela. */
  install(target: ErrorEventTarget): void
}

export const MAX_ERRORS_PER_PAGE = 10

/** `trace_id` W3C (32 hex), o mesmo do `x-trace-id` da API. */
const TRACE_ID = /^[0-9a-f]{32}$/

/** `trace_id` de um erro que veio da API (`ApiError.traceId`), sem importar a camada de dados. */
export function traceIdOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('traceId' in error)) {
    return null
  }
  const { traceId } = error
  return typeof traceId === 'string' && TRACE_ID.test(traceId) ? traceId : null
}

function fingerprintOf(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}:${error.message}:${error.stack?.split('\n', 2)[1] ?? ''}`
  }
  return `${typeof error}:${String(error)}`
}

export function createErrorCapture(options: ErrorCaptureOptions): ErrorCapture {
  const { key, release, load } = options
  const seen = new Set<string>()
  const queue: { error: unknown; properties: ErrorProperties }[] = []
  let client: ErrorClient | null = null
  let loading = false
  let disabled = key === undefined

  function drain(): void {
    if (client === null) {
      return
    }
    for (const item of queue.splice(0)) {
      try {
        client.capture(item.error, item.properties)
      } catch {
        // O SDK nunca derruba a página.
      }
    }
  }

  function start(currentKey: string): void {
    if (loading) {
      return
    }
    loading = true
    load(currentKey).then(
      (loaded) => {
        client = loaded
        drain()
      },
      () => {
        disabled = true
        queue.length = 0
      },
    )
  }

  function report(error: unknown): void {
    if (disabled || key === undefined || seen.size >= MAX_ERRORS_PER_PAGE) {
      return
    }
    const fingerprint = fingerprintOf(error)
    if (seen.has(fingerprint)) {
      return
    }
    seen.add(fingerprint)
    const traceId = traceIdOf(error)
    queue.push({
      error,
      properties: {
        ...(traceId === null ? {} : { trace_id: traceId }),
        ...(release === undefined ? {} : { release }),
      },
    })
    if (client === null) {
      start(key)
    } else {
      drain()
    }
  }

  return {
    report,
    install(target) {
      if (disabled) {
        return
      }
      target.addEventListener('error', (event) => {
        // Erro de carregamento de recurso (`<img>`, `<script>`) não é `ErrorEvent`: fica de fora.
        if (!(event instanceof ErrorEvent)) {
          return
        }
        const error: unknown = event.error
        if (error !== undefined && error !== null) {
          report(error)
        } else if (event.message !== '') {
          report(new Error(event.message))
        }
      })
      target.addEventListener('unhandledrejection', (event) => {
        if ('reason' in event) {
          report(event.reason)
        }
      })
    },
  }
}
