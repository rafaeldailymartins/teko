import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * Proteção contra CSRF em `/api/*` (aplicação e Better Auth). Web e API estão na mesma origem
 * (ADR 0029), sem CORS: toda mutação legítima vem do próprio front, com `Origin` igual ao domínio
 * do ambiente.
 *
 * Em todo método que muda estado (tudo fora de GET, HEAD e OPTIONS), inclusive o stream (POST):
 *
 * - `Origin` ausente ou diferente de `WEB_ORIGIN` → 403 `forbidden`;
 * - POST, PUT e PATCH sem `content-type: application/json` → 415 (`validation_error`);
 * - só em `/api/v1/*`, query string → 400 `validation_error`: as mutações da aplicação só leem o
 *   corpo e os parâmetros do caminho, e um parâmetro na URL acaba em log de proxy e no histórico.
 *
 * `/api/auth/*` entra porque o Better Auth só confere o `Origin` quando a requisição traz cookie:
 * um `sign-in/social` disparado de outro site passaria. O callback do OAuth chega por GET.
 */
const GUARDED_PREFIX = '/api/'
const APP_PREFIX = '/api/v1/'

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
    if (request.url.startsWith(APP_PREFIX) && request.url.includes('?')) {
      throw app.httpErrors.badRequest('Query string is not allowed in mutations')
    }
  })
}
