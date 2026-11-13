import rateLimit, {
  type FastifyRateLimitStore,
  type FastifyRateLimitStoreCtor,
} from '@fastify/rate-limit'
import underPressure from '@fastify/under-pressure'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'
import { MAX_EVENT_LOOP_DELAY_MS, type RateLimitOptions } from '../http-options.ts'

/**
 * `under-pressure`: com o event loop atrasado mais de 1 s (dimensionado para 1 vCPU por
 * instância), responde 503 (`Retry-After`) em vez de enfileirar trabalho. O `/healthz` também
 * passa a dar 503. Com `eventLoopDelayGuard: false` (Vercel), o limite fica desligado (`0`, o
 * padrão do plugin): o congelamento da instância entre invocações seria lido como atraso.
 */
export async function registerUnderPressure(
  app: FastifyInstance,
  options: { readonly eventLoopDelayGuard: boolean },
): Promise<void> {
  await app.register(underPressure, {
    maxEventLoopDelay: options.eventLoopDelayGuard ? MAX_EVENT_LOOP_DELAY_MS : 0,
    exposeStatusRoute: false,
  })
}

/** Lê uma string de um objeto de opções sem tipo conhecido (as do plugin chegam mescladas). */
function stringField(source: unknown, field: string): string | undefined {
  if (typeof source !== 'object' || source === null) {
    return undefined
  }
  const value: unknown = Reflect.get(source, field)
  return typeof value === 'string' ? value : undefined
}

/**
 * Namespace do contador de uma rota: `MÉTODO url`, ou `group` nas rotas com `groupId` (que
 * dividem a mesma cota; o próprio plugin já acrescenta o `groupId` à chave). O plugin entrega ao
 * `child` os parâmetros mesclados com `routeInfo`.
 */
export function rateLimitNamespace(params: unknown): string {
  if (stringField(params, 'groupId') !== undefined) {
    return 'group'
  }
  const routeInfo: unknown =
    typeof params === 'object' && params !== null ? Reflect.get(params, 'routeInfo') : undefined
  const url = stringField(routeInfo, 'url')
  if (url === undefined) {
    return 'global'
  }
  // `routeInfo` é objeto aqui: `stringField` só acha `url` em objetos.
  const method: unknown = Reflect.get(Object(routeInfo), 'method')
  const methods = [method].flat().filter((name): name is string => typeof name === 'string')
  return methods.length === 0 ? url : `${methods.join(',')} ${url}`
}

/**
 * Adapta a porta `RateLimitStore` ao contrato de store do `@fastify/rate-limit` (classe com
 * `incr` por callback e `child` por rota).
 */
function rateLimitStoreCtor(port: RateLimitStore): FastifyRateLimitStoreCtor {
  class PortStore implements FastifyRateLimitStore {
    readonly #namespace: string

    constructor(_options: unknown, namespace = 'global') {
      this.#namespace = namespace
    }

    incr(
      key: string,
      callback: (error: Error | null, result?: { current: number; ttl: number }) => void,
      timeWindow: number,
    ): void {
      port.hit(`${this.#namespace}|${key}`, timeWindow).then(
        (hit) => {
          callback(null, { current: hit.count, ttl: hit.resetInMs })
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error('rate limit store failed'))
        },
      )
    }

    child(routeOptions: unknown): FastifyRateLimitStore {
      return new PortStore(routeOptions, rateLimitNamespace(routeOptions))
    }
  }
  return PortStore
}

/**
 * Chave do limite na F1: o IP do cliente, resolvido pela porta `ClientIp` da plataforma (web e API
 * na mesma origem, ADR 0029: o IP vale em todas as rotas). A F4 acrescenta a sessão (`user_id` ou
 * sessão anônima do Better Auth) como chave preferencial.
 */
function rateLimitKey(request: FastifyRequest): string {
  const { ip } = request.server.container.clientIp.resolve({
    headers: request.headers,
    forwardedIp: request.ip,
  })
  return ip === null ? `socket:${request.ip}` : `ip:${ip}`
}

/**
 * Rate limit de aplicação, só nas rotas que optam por ele (`config.rateLimit`), com store
 * compartilhado: as rotas que já abrem transação (mutações, `/me/*`, histórico e `provisions`).
 * `/healthz` e `/api/v1/coverage` ficam fora, para não acordar o Neon à toa.
 *
 * O erro 429 segue para o error handler, que o converte em problem+json `rate_limited`; os
 * headers `x-ratelimit-*` e `retry-after` já foram gravados pelo plugin.
 */
export async function registerRateLimit(
  app: FastifyInstance,
  options: RateLimitOptions,
): Promise<void> {
  await app.register(rateLimit, {
    global: false,
    max: options.max,
    timeWindow: options.timeWindowMs,
    store: rateLimitStoreCtor(options.store),
    keyGenerator: rateLimitKey,
  })
}
