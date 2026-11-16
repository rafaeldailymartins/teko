import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { FastifyInstance } from 'fastify'

/**
 * Request id de cada requisição (o da borda, nos logs), devolvido ao cliente em `x-request-id`. O
 * `traceId` do problem+json e o `x-trace-id` são o `trace_id` do OTel (`telemetry.ts`).
 *
 * A origem depende da plataforma (`HttpOptions.requestIdHeader`): `x-vercel-id`, que a borda da
 * Vercel gera; `x-request-id`, que o Caddy da stack de CI e do proxy local sobrescreve com um UUID
 * próprio; ou nenhuma (sempre um UUID). Mesmo vindo da borda, o valor é validado: fora do formato
 * esperado, gera-se um UUID novo, para que nada arbitrário vá parar nos logs.
 */
export const REQUEST_ID_HEADER = 'x-request-id'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

export function isAcceptableRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

/** `genReqId` do Fastify (com `requestIdHeader: false`, é sempre chamado). */
export function createRequestIdGenerator(
  incomingHeader: string | null,
): (req: IncomingMessage) => string {
  if (incomingHeader === null) {
    return () => randomUUID()
  }
  return (req) => {
    const incoming = req.headers[incomingHeader]
    return isAcceptableRequestId(incoming) ? incoming : randomUUID()
  }
}

/** Devolve o request id em toda resposta, inclusive erros, para correlacionar com os logs. */
export function registerRequestIdHeader(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id)
  })
}
