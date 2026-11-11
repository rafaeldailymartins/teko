import helmet from '@fastify/helmet'
import type { FastifyInstance } from 'fastify'

/**
 * A API só devolve JSON, problem+json e SSE: nenhuma resposta precisa carregar script, estilo ou
 * frame. Por isso a CSP é `default-src 'none'` (a exceção é a referência Scalar, fora de produção,
 * que relaxa a CSP só nas próprias rotas; ver `openapi.ts`).
 */
const API_CONTENT_SECURITY_POLICY = {
  useDefaults: false,
  directives: {
    defaultSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'none'"],
    formAction: ["'none'"],
  },
} as const

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: API_CONTENT_SECURITY_POLICY,
  })
}

/**
 * Hook global em `/api/*`: `Cache-Control: private, no-store` e `Vary: Cookie`. Impede que a CDN
 * da Netlify cacheie respostas proxiadas (que dependem da sessão). O Fastify não gera ETag, e
 * nenhum plugin de ETag é registrado.
 */
export const API_CACHE_CONTROL = 'private, no-store'

export function registerApiCacheControl(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api' || request.url.startsWith('/api/')) {
      reply.header('cache-control', API_CACHE_CONTROL)
      reply.header('vary', 'Cookie')
    }
  })
}
