import swagger from '@fastify/swagger'
import scalar from '@scalar/fastify-api-reference'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

/**
 * OpenAPI 3.1 gerado dos schemas Zod das rotas (`@fastify/swagger` + `jsonSchemaTransform`) e
 * referência Scalar em `/api/docs`, com o documento em `/api/docs/json` (fonte do codegen da web
 * e do scan de API do ZAP). Só é registrado fora de produção.
 *
 * Precisa ser registrado antes das rotas: o swagger coleta as rotas pelo hook `onRoute`.
 */
export const DOCS_PREFIX = '/api/docs'
export const DOCS_JSON_PATH = `${DOCS_PREFIX}/json`

/**
 * A página do Scalar carrega o próprio bundle (servido pelo plugin em `/api/docs/js/scalar.js`),
 * um script inline de configuração e estilos inline. A CSP global da API (`default-src 'none'`)
 * bloquearia tudo isso, então ela é relaxada só nas rotas da documentação.
 */
export const DOCS_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export interface OpenApiOptions {
  readonly version: string
}

async function relaxDocsCsp(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('content-security-policy', DOCS_CONTENT_SECURITY_POLICY)
}

export async function registerOpenApi(
  app: FastifyInstance,
  options: OpenApiOptions,
): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Tekó API',
        description:
          'API do Tekó: perguntas sobre a legislação tributária brasileira com consciência de vigência.',
        version: options.version,
      },
    },
    transform: jsonSchemaTransform,
  })

  await app.register(scalar, {
    routePrefix: DOCS_PREFIX,
    openApiDocumentEndpoints: { json: '/json', yaml: '/yaml' },
    logLevel: 'warn',
    hooks: { onRequest: relaxDocsCsp },
  })
}
