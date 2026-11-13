import fastifyStatic from '@fastify/static'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  IMMUTABLE_CACHE_CONTROL,
  notFoundPageFor,
  ROOT_REDIRECT_HEADERS,
  rootRedirectFor,
  STATIC_HEADERS,
} from './policy.ts'

/**
 * Export estático do web servido pelo próprio Fastify, na mesma origem da API (ADR 0029). Só no
 * Plano B (Render, `WEB_STATIC_DIR`); na Vercel quem serve é a CDN, pelas rotas do `config.json`
 * (`scripts/build-vercel-output.ts`), com a mesma política (`policy.ts`):
 *
 * - `/` → `/en/` ou `/pt-BR/` pelo `Accept-Language` (302, sem cache compartilhado);
 * - `/pt-br/...` → `/pt-BR/...` (308);
 * - arquivos do export pelo `@fastify/static` (diretório sem barra final redireciona para a barra;
 *   `index.html` do diretório), com os headers de segurança do estático no lugar dos da API e
 *   `/_next/static/*` imutável;
 * - caminho inexistente fora de `/api/*` e `/healthz`: a página de 404 do locale, com status 404
 *   (`staticNotFound`, chamado pelo not-found handler do problem+json).
 */

export interface StaticSiteOptions {
  /** Diretório absoluto do export (`apps/web/out`). */
  readonly root: string
}

const API_PATH = /^\/(?:api(?:\/|$)|healthz$)/

function pathOf(request: FastifyRequest): string {
  const queryStart = request.url.indexOf('?')
  return queryStart === -1 ? request.url : request.url.slice(0, queryStart)
}

/** Requisição que o site estático atende (nunca a API). */
export function isStaticRequest(request: FastifyRequest): boolean {
  return (request.method === 'GET' || request.method === 'HEAD') && !API_PATH.test(pathOf(request))
}

/**
 * Not-found do estático: a página de 404 do locale do caminho. Devolve `null` para o que não é do
 * estático, e o problem+json continua valendo (API, métodos que mudam estado).
 */
export function staticNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply | null {
  if (!isStaticRequest(request)) {
    return null
  }
  return reply.code(404).sendFile(notFoundPageFor(pathOf(request)))
}

export async function registerStaticSite(
  app: FastifyInstance,
  options: StaticSiteOptions,
): Promise<void> {
  // Os headers da API (helmet, CSP `default-src 'none'`) derrubariam o HTML: no estático valem os
  // da política, os mesmos que a Vercel aplica.
  app.addHook('onSend', async (request, reply, payload) => {
    if (isStaticRequest(request)) {
      reply.headers(STATIC_HEADERS)
    }
    return payload
  })

  app.get('/', { schema: { hide: true } }, (request, reply) =>
    reply
      .code(302)
      .headers({
        ...ROOT_REDIRECT_HEADERS,
        location: rootRedirectFor(request.headers['accept-language']),
      })
      .send(),
  )
  const lowercaseLocale = (
    request: FastifyRequest<{ Params: { '*'?: string } }>,
    reply: FastifyReply,
  ) =>
    reply
      .code(308)
      .header('location', `/pt-BR/${request.params['*'] ?? ''}`)
      .send()
  app.get('/pt-br', { schema: { hide: true } }, (_request, reply) =>
    reply.code(308).header('location', '/pt-BR/').send(),
  )
  app.get('/pt-br/*', { schema: { hide: true } }, lowercaseLocale)

  await app.register(fastifyStatic, {
    root: options.root,
    prefix: '/',
    wildcard: true,
    index: ['index.html'],
    redirect: true,
    dotfiles: 'ignore',
    // O `index` acima já serve o diretório; sem listagem.
    list: false,
    schemaHide: true,
    setHeaders: (reply, path) => {
      if (path.replaceAll('\\', '/').includes('/_next/static/')) {
        reply.header('cache-control', IMMUTABLE_CACHE_CONTROL)
      }
    },
  })
}
