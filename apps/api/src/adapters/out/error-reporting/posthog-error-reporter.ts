import type { AppEnv } from '@teko/shared/contracts'
import type { EventMessage } from 'posthog-node'
import type { ErrorReportContext, ErrorReporterPort } from '#app/ports/error-reporter.ts'
import { lazyModule, type Preloadable } from '../lazy-module.ts'
import { scrubError } from './scrub.ts'

/**
 * Erros inesperados da API no PostHog Error Tracking (UE; ADR 0037), pelo `posthog-node`.
 *
 * - Cada erro sai por `captureExceptionImmediate` (sem fila nem timer: a instância da Vercel pausa
 *   entre requisições); o `flush` só espera os envios em andamento, e o adapter HTTP o põe em
 *   `BackgroundTasks` com teto de 500 ms quando houve erro.
 * - O erro passa pelo scrubber (`scrub.ts`) antes do SDK; o `before_send` ainda descarta qualquer
 *   evento que não seja `$exception`.
 * - `distinct_id` é o `trace_id` da requisição: um identificador técnico e aleatório, que não liga o
 *   erro a uma pessoa nem junta erros de pessoas diferentes num perfil (`$process_person_profile`
 *   falso; sem GeoIP, que seria o do servidor). Nada de corpo, pergunta, e-mail, IP nem usuário.
 * - O `posthog-node` entra por import dinâmico no primeiro erro reportado: o cold start da Function
 *   não o carrega, e um processo sem erro nunca o carrega (nem o encerra).
 */

/** Ingestão do PostHog na UE, a única região do Tekó (fixa no código, como os hosts de LLM). */
export const POSTHOG_EU_HOST = 'https://eu.i.posthog.com'

/** Teto de cada envio ao PostHog (o flush por requisição tem o próprio teto de 500 ms). */
const REQUEST_TIMEOUT_MS = 3000

/** O pedaço do cliente do `posthog-node` que o adapter usa (os testes passam um falso). */
export interface ExceptionClient {
  captureExceptionImmediate(
    error: unknown,
    distinctId?: string,
    properties?: Record<string, unknown>,
  ): Promise<void>
  shutdown(timeoutMs?: number): Promise<void>
}

export interface PosthogErrorReporterOptions {
  /** Chave do projeto (`phc_…`). */
  readonly projectKey: string
  /** `teko@X.Y.Z` (produção) ou `teko@<sha7>` (`errorTrackingRelease`). */
  readonly release: string
  readonly appEnv: AppEnv
  /** Cliente pronto (testes); sem ele, um `PostHog` do `posthog-node` apontado para a UE. */
  readonly client?: ExceptionClient
}

/** Linhas do código-fonte que o SDK lê do disco em volta de cada frame. */
const SOURCE_CONTEXT_KEYS = ['pre_context', 'context_line', 'post_context'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Frame sem as linhas de código em volta: a pilha se resolve pelos source maps (ADR 0037). */
function withoutSourceContext(frame: unknown): unknown {
  if (!isRecord(frame)) {
    return frame
  }
  const copy = { ...frame }
  for (const key of SOURCE_CONTEXT_KEYS) {
    delete copy[key]
  }
  return copy
}

function withoutFrameContext(exception: unknown): unknown {
  if (!isRecord(exception) || !isRecord(exception['stacktrace'])) {
    return exception
  }
  const { stacktrace } = exception
  const frames = stacktrace['frames']
  return Array.isArray(frames)
    ? { ...exception, stacktrace: { ...stacktrace, frames: frames.map(withoutSourceContext) } }
    : exception
}

/**
 * Filtro final do SDK: só `$exception` sai, e sem as linhas de código-fonte que o `posthog-node` lê
 * do disco (`context_line` e vizinhas): o trecho em volta do frame pode ter um literal qualquer, e a
 * pilha se resolve pelos source maps enviados no deploy.
 */
export function onlyExceptions(event: EventMessage): EventMessage | null {
  if (event.event !== '$exception') {
    return null
  }
  const list: unknown = event.properties?.['$exception_list']
  if (!Array.isArray(list)) {
    return event
  }
  return {
    ...event,
    properties: { ...event.properties, $exception_list: list.map(withoutFrameContext) },
  }
}

async function createClient(projectKey: string): Promise<ExceptionClient> {
  const { PostHog } = await import('posthog-node')
  return new PostHog(projectKey, {
    host: POSTHOG_EU_HOST,
    flushAt: 20,
    flushInterval: 0,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    featureFlagsPollingInterval: null,
    requestTimeout: REQUEST_TIMEOUT_MS,
    fetchRetryCount: 1,
    before_send: onlyExceptions,
  })
}

export function createPosthogErrorReporter(
  options: PosthogErrorReporterOptions,
): ErrorReporterPort & Preloadable {
  const injected = options.client
  const client =
    injected === undefined
      ? lazyModule(() => createClient(options.projectKey))
      : () => Promise.resolve(injected)
  /** Algum erro já pediu o cliente (sem isso, o encerramento não carrega o SDK só para fechá-lo). */
  let used = injected !== undefined
  const sending = new Set<Promise<void>>()

  async function flush(): Promise<void> {
    await Promise.allSettled([...sending])
  }

  return {
    enabled: true,
    async preload() {
      used = true
      await client()
    },
    report(error: unknown, context: ErrorReportContext) {
      try {
        const scrubbed = scrubError(error)
        used = true
        const send = client()
          .then((ready) =>
            ready.captureExceptionImmediate(scrubbed, context.traceId, {
              $process_person_profile: false,
              trace_id: context.traceId,
              http_method: context.method,
              http_route: context.route,
              http_status_code: context.statusCode,
              error_code: scrubbed.errorCode,
              release: options.release,
              app_env: options.appEnv,
              service: 'teko-api',
            }),
          )
          .catch(() => {})
        sending.add(send)
        void send.finally(() => sending.delete(send))
      } catch {
        // Reportar um erro nunca derruba a resposta.
      }
    },
    flush,
    async shutdown(timeoutMs) {
      try {
        await flush()
        if (used) {
          await (await client()).shutdown(timeoutMs)
        }
      } catch {
        // Encerramento: o que não saiu se perde.
      }
    },
  }
}
