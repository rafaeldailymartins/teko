import { randomBytes } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { context, isSpanContextValid, trace } from '@opentelemetry/api'
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify'

/**
 * Telemetria no adapter HTTP (`docs/architecture/observabilidade.md`):
 *
 * 1. o plugin do `@fastify/otel` (quando a telemetria está ligada) abre o span `request` de cada
 *    requisição, filho do `traceparent` que o navegador manda;
 * 2. `x-trace-id` em toda resposta (inclusive nos Problem Details, que levam o mesmo valor em
 *    `traceId`): o `trace_id` do span da requisição; sem SDK, o do `traceparent` recebido; sem os
 *    dois, um id aleatório no mesmo formato (32 hex);
 * 3. `http.server.request.duration` de toda requisição respondida;
 * 4. ao fim de cada requisição de `/api` (menos o health check), o flush da telemetria vai para
 *    `BackgroundTasks` com teto de 500 ms. O flush espera uma volta do event loop, para levar também
 *    os logs escritos no fim da resposta.
 */
export const TRACE_ID_HEADER = 'x-trace-id'

/** Teto do flush por requisição (`waitUntil` na Vercel). */
export const TELEMETRY_FLUSH_TIMEOUT_MS = 500

export interface HttpTelemetry {
  /** Plugin do `@fastify/otel` do provider da aplicação. */
  readonly plugin: FastifyPluginCallback
  /** Exporta o que está pendente (traces, logs e, no máximo 1x/min, métricas). Nunca rejeita. */
  readonly flush: () => Promise<void>
}

declare module 'fastify' {
  interface FastifyRequest {
    /** `trace_id` W3C da requisição (o mesmo do `x-trace-id` e do `traceId` dos erros). */
    traceId: string
  }
}

const TRACEPARENT_PATTERN = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/
const ZERO_TRACE_ID = '0'.repeat(32)

/** `trace_id` de um `traceparent` W3C válido (versão 00), ou `null`. */
export function traceIdFromTraceparent(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null
  }
  const traceId = TRACEPARENT_PATTERN.exec(header.trim())?.[1]
  return traceId === undefined || traceId === ZERO_TRACE_ID ? null : traceId
}

function activeTraceId(): string | null {
  const spanContext = trace.getSpan(context.active())?.spanContext()
  return spanContext !== undefined && isSpanContextValid(spanContext) ? spanContext.traceId : null
}

function randomTraceId(): string {
  return randomBytes(16).toString('hex')
}

function resolveTraceId(request: Pick<FastifyRequest, 'headers'>): string {
  const { traceparent } = request.headers
  return activeTraceId() ?? traceIdFromTraceparent(traceparent) ?? randomTraceId()
}

const HEALTH_PATHS: ReadonlySet<string> = new Set(['/healthz', '/api/healthz'])

function pathOf(url: string): string {
  const query = url.indexOf('?')
  return query === -1 ? url : url.slice(0, query)
}

/** Requisições cujo fim dispara o flush: `/api/*`, menos o health check (que não pode custar). */
export function flushesTelemetry(url: string): boolean {
  const path = pathOf(url)
  return path.startsWith('/api/') && !HEALTH_PATHS.has(path)
}

export async function registerTelemetry(
  app: FastifyInstance,
  telemetry: HttpTelemetry | undefined,
): Promise<void> {
  if (telemetry !== undefined) {
    await app.register(telemetry.plugin)
  }
  app.decorateRequest('traceId', '')
  app.addHook('onRequest', async (request, reply) => {
    request.traceId = resolveTraceId(request)
    reply.header(TRACE_ID_HEADER, request.traceId)
  })
  app.addHook('onResponse', async (request, reply) => {
    const { container } = request.server
    container.telemetry.httpRequest({
      method: request.method,
      route: request.routeOptions.url ?? null,
      statusCode: reply.statusCode,
      durationSeconds: reply.elapsedTime / 1000,
    })
    if (telemetry !== undefined && flushesTelemetry(request.url)) {
      container.backgroundTasks.run(
        'telemetry-flush',
        nextTurn().then(() => telemetry.flush()),
        { timeoutMs: TELEMETRY_FLUSH_TIMEOUT_MS },
      )
    }
  })
}
