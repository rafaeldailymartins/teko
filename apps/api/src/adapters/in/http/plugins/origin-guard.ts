import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Proteção contra CSRF nas rotas da aplicação (`/api/v1/*`). Web e API estão na mesma origem
 * (ADR 0029), sem CORS: toda mutação legítima vem do próprio front, com `Origin` igual ao domínio
 * do ambiente.
 *
 * Em todo método que muda estado (tudo fora de GET, HEAD e OPTIONS), inclusive o stream (POST):
 *
 * - `Origin` ausente ou diferente de `WEB_ORIGIN` → 403 `forbidden`;
 * - POST, PUT e PATCH sem `content-type: application/json` → 415 (`validation_error`);
 * - query string → 400 `validation_error`: as mutações só leem o corpo e os parâmetros do caminho,
 *   e um parâmetro na URL acaba em log de proxy e no histórico do navegador.
 *
 * `/api/auth/*` fica de fora: o Better Auth confere o `Origin` contra os `trustedOrigins` dele, e o
 * callback do OAuth chega por GET de outro site.
 */
const GUARDED_PREFIX = '/api/v1/'

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])
const BODY_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH'])

export interface OriginGuardOptions {
  /** Origem exata do ambiente (`WEB_ORIGIN`). */
  readonly webOrigin: string
}

function isJson(request: FastifyRequest): boolean {
  const type = request.headers['content-type']
  if (type === undefined) {
    return false
  }
  return type.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

export function registerOriginGuard(app: FastifyInstance, options: OriginGuardOptions): void {
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith(GUARDED_PREFIX)) {
      return
    }
    if (request.headers.origin !== options.webOrigin) {
      throw app.httpErrors.forbidden('Origin not allowed')
    }
    if (BODY_METHODS.has(request.method) && !isJson(request)) {
      throw app.httpErrors.unsupportedMediaType('Content-Type must be application/json')
    }
    if (request.url.includes('?')) {
      throw app.httpErrors.badRequest('Query string is not allowed in mutations')
    }
  })
}
