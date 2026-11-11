import { createHmac, timingSafeEqual } from 'node:crypto'
import { Readable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import type { FastifyBaseLogger } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { SpikeRouteOptions } from '../http-options.ts'

/**
 * Rotas TEMPORÁRIAS dos spikes da F1 (b) e (c), em `/api/_spike/*`. São registradas só em staging
 * na Vercel (`createHttpOptions`) e saem quando os spikes forem fechados (ADR 0003). Nenhuma toca
 * o banco nem devolve valor de segredo.
 *
 * - `GET /api/_spike/sse`: SSE com o primeiro byte atrasado, heartbeat `: hb` e duração total
 *   configuráveis. Loga a desconexão do cliente (`request.signal` e `close` da resposta) para o
 *   spike conferir nos logs de runtime da Vercel, com e sem `supportsCancellation`.
 * - `GET|POST /api/_spike/echo`: o que chega à Function pelo proxy assinado da Netlify (claims do
 *   `x-nf-sign`, IPs, nomes de cookies) e um `Set-Cookie` de teste.
 * - `GET /api/_spike/runtime`: Node, região, `maxDuration`, orçamento do stream e se a Sensitive de
 *   teste existe (só o tamanho).
 * - `POST /api/_spike/wait-until`: agenda uma tarefa pós-resposta e a loga quando termina.
 */

/** Teto da duração do SSE de spike (abaixo do `maxDuration` de 300 s). */
const MAX_STREAM_S = 150

const sseQuerySchema = z.object({
  firstByteDelayS: z.coerce.number().int().min(0).max(60).default(30),
  durationS: z.coerce.number().int().min(1).max(MAX_STREAM_S).default(95),
  heartbeatS: z.coerce.number().int().min(1).max(30).default(15),
})
export type SpikeSseQuery = z.output<typeof sseQuerySchema>

const waitUntilQuerySchema = z.object({
  delayMs: z.coerce.number().int().min(0).max(5000).default(1500),
})

/** Headers que o spike (c) compara entre o caminho direto e o proxiado. */
const ECHO_HEADERS = [
  'x-nf-client-connection-ip',
  'x-nf-request-id',
  'x-nf-deploy-context',
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-vercel-id',
  'via',
  'user-agent',
] as const

/** Cookie que o eco grava, para conferir a passagem de `Set-Cookie` pelo proxy. */
export const SPIKE_COOKIE = 'teko_spike=1; Path=/api/_spike; Secure; HttpOnly; SameSite=Lax'

export interface SignatureCheck {
  readonly present: boolean
  /** Claims do JWS (sem a assinatura); `null` se ausente ou malformado. */
  readonly claims: Record<string, unknown> | null
  /** `null` = sem segredo configurado para verificar. */
  readonly verified: boolean | null
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

/**
 * Lê o `x-nf-sign` (JWS HS256 compacto). As claims voltam mesmo sem segredo, porque o spike quer
 * ver o `deploy_context` real; a assinatura só é conferida com o segredo configurado.
 */
export function inspectSignature(token: string | undefined, secret?: string): SignatureCheck {
  if (token === undefined || token === '') {
    return { present: false, claims: null, verified: null }
  }
  const parts = token.split('.')
  const [header, payload, signature] = parts
  if (
    parts.length !== 3 ||
    header === undefined ||
    payload === undefined ||
    signature === undefined
  ) {
    return { present: true, claims: null, verified: secret === undefined ? null : false }
  }
  let claims: Record<string, unknown> | null = null
  try {
    const decoded = decodeSegment(payload)
    claims =
      typeof decoded === 'object' && decoded !== null ? (decoded as Record<string, unknown>) : null
  } catch {
    claims = null
  }
  if (secret === undefined) {
    return { present: true, claims, verified: null }
  }
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest()
  const received = Buffer.from(signature, 'base64url')
  const verified = received.length === expected.length && timingSafeEqual(received, expected)
  return { present: true, claims, verified }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) {
    return null
  }
  return Array.isArray(value) ? value.join(', ') : value
}

/** Nomes (nunca valores) dos cookies recebidos. */
export function cookieNames(cookieHeader: string | undefined): string[] {
  if (cookieHeader === undefined || cookieHeader === '') {
    return []
  }
  return cookieHeader
    .split(';')
    .map((pair) => pair.split('=')[0]?.trim() ?? '')
    .filter((name) => name !== '')
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * Corpo do SSE de spike. Nada sai antes de `firstByteDelayS` (os headers já foram enviados); depois,
 * `start`, um heartbeat a cada `heartbeatS` e `end` ao completar `durationS`, contados do início.
 */
export async function* spikeSseBody(
  query: SpikeSseQuery,
  signal: AbortSignal,
  now: () => number = Date.now,
): AsyncGenerator<string> {
  const startedAt = now()
  const elapsed = (): number => now() - startedAt
  try {
    await sleep(query.firstByteDelayS * 1000, undefined, { signal })
    yield sseEvent('start', { elapsedMs: elapsed() })
    const endAt = query.durationS * 1000
    while (elapsed() < endAt) {
      await sleep(Math.min(query.heartbeatS * 1000, endAt - elapsed()), undefined, { signal })
      if (elapsed() < endAt) {
        yield `: hb ${String(elapsed())}\n\n`
      }
    }
    yield sseEvent('end', { elapsedMs: elapsed() })
  } catch (error) {
    if (!isAbort(error)) {
      throw error
    }
  }
}

/** Liga os dois sinais de desconexão ao log, cada um no máximo uma vez. */
function watchDisconnect(
  log: FastifyBaseLogger,
  signal: AbortSignal,
  response: NodeJS.EventEmitter & { readonly writableFinished: boolean },
  startedAt: number,
): void {
  signal.addEventListener(
    'abort',
    () => {
      log.info(
        { spike: 'sse', via: 'request.signal', elapsedMs: Date.now() - startedAt },
        'spike sse: cliente desconectou',
      )
    },
    { once: true },
  )
  response.once('close', () => {
    if (!response.writableFinished) {
      log.info(
        { spike: 'sse', via: 'response close', elapsedMs: Date.now() - startedAt },
        'spike sse: resposta fechada antes do fim',
      )
    }
  })
}

export function spikeRoutes(options: SpikeRouteOptions): FastifyPluginAsyncZod {
  return async (app) => {
    app.get(
      '/api/_spike/sse',
      { schema: { hide: true, querystring: sseQuerySchema }, config: { rateLimit: false } },
      async (request, reply) => {
        const startedAt = Date.now()
        watchDisconnect(request.log, request.signal, reply.raw, startedAt)
        request.log.info({ spike: 'sse', query: request.query }, 'spike sse: início')
        return reply
          .header('content-type', 'text/event-stream; charset=utf-8')
          .header('cache-control', 'no-cache, no-transform')
          .header('x-accel-buffering', 'no')
          .send(Readable.from(spikeSseBody(request.query, request.signal)))
      },
    )

    app.route({
      method: ['GET', 'POST'],
      url: '/api/_spike/echo',
      schema: { hide: true },
      config: { rateLimit: false },
      handler: async (request, reply) => {
        const headers = Object.fromEntries(
          ECHO_HEADERS.map((name) => [name, headerValue(request.headers[name])]),
        )
        const sign = request.headers['x-nf-sign']
        return reply.header('set-cookie', SPIKE_COOKIE).send({
          method: request.method,
          ip: request.ip,
          headers,
          cookieNames: cookieNames(request.headers.cookie),
          nfSign: inspectSignature(Array.isArray(sign) ? sign[0] : sign, options.proxySecret),
          receivedAt: new Date().toISOString(),
        })
      },
    })

    app.get(
      '/api/_spike/runtime',
      { schema: { hide: true }, config: { rateLimit: false } },
      async () => ({
        nodeVersion: options.nodeVersion,
        region: options.region,
        maxDurationS: options.maxDurationS,
        // Orçamento de um stream que começasse agora numa invocação iniciada agora.
        streamBudgetMs: app.container.streamBudget.timeoutMs(Date.now(), Date.now()),
        sensitive: { present: options.sensitiveLength !== null, length: options.sensitiveLength },
        proxySecretConfigured: options.proxySecret !== undefined,
      }),
    )

    app.post(
      '/api/_spike/wait-until',
      { schema: { hide: true, querystring: waitUntilQuerySchema }, config: { rateLimit: false } },
      async (request, reply) => {
        const { delayMs } = request.query
        const scheduledAt = Date.now()
        const log = request.log
        app.container.backgroundTasks.run(
          'spike-wait-until',
          sleep(delayMs).then(() => {
            log.info(
              { spike: 'wait-until', delayMs, ranAfterMs: Date.now() - scheduledAt },
              'spike wait-until: tarefa pós-resposta concluída',
            )
          }),
          { timeoutMs: delayMs + 1000 },
        )
        return reply.code(202).send({ scheduledAt: new Date(scheduledAt).toISOString(), delayMs })
      },
    )
  }
}
