import sensible from '@fastify/sensible'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { BODY_LIMIT_BYTES, type HttpOptions } from '#adapters/in/http/http-options.ts'
import { decorateContainer } from '#adapters/in/http/plugins/container.ts'
import {
  registerRateLimit,
  registerUnderPressure,
} from '#adapters/in/http/plugins/load-protection.ts'
import { registerOpenApi } from '#adapters/in/http/plugins/openapi.ts'
import {
  createRequestIdGenerator,
  registerRequestIdHeader,
} from '#adapters/in/http/plugins/request-id.ts'
import {
  registerApiCacheControl,
  registerSecurityHeaders,
} from '#adapters/in/http/plugins/security-headers.ts'
import { STREAM_PREFIX, streamScope } from '#adapters/in/http/plugins/stream-cors.ts'
import { registerProblemHandlers } from '#adapters/in/http/problem/error-handler.ts'
import { healthRoutes } from '#adapters/in/http/routes/health.ts'
import { spikeRoutes } from '#adapters/in/http/routes/spike.ts'
import type { Container } from '#app/container.ts'

export interface BuildAppDeps {
  readonly container: Container
  readonly http: HttpOptions
  /** Logger raiz (pino). Ausente = sem logs (testes). */
  readonly logger?: FastifyBaseLogger
}

type FastifyTrustProxy = boolean | string[] | ((address: string, hop: number) => boolean)

/**
 * O Fastify aceita um número de saltos em runtime (repassado ao `proxy-addr`), mas os tipos dele
 * não; a função equivalente do `proxy-addr` confia nos `hops` primeiros endereços, a contar do
 * socket (salto 0).
 */
export function fastifyTrustProxy(trustProxy: HttpOptions['trustProxy']): FastifyTrustProxy {
  if (typeof trustProxy === 'boolean') {
    return trustProxy
  }
  if (typeof trustProxy === 'number') {
    return (_address, hop) => hop < trustProxy
  }
  return [...trustProxy]
}

/**
 * Monta a aplicação Fastify sem abrir porta (`listen` fica em `server.ts`, o único entrypoint
 * HTTP; os testes usam `app.inject`). A ordem segue o pipeline HTTP do plano:
 *
 *  1. opções do Fastify: logger com redact, `bodyLimit` 32 KB, request id, `trustProxy` por
 *     plataforma;
 *  2. compilers Zod (o `@fastify/otel` entra aqui na F6);
 *  3. `under-pressure`;
 *  4. `helmet` (CSP `default-src 'none'`);
 *  5. hook `/api/*` com `Cache-Control: private, no-store` e `Vary: Cookie`;
 *  6. assinatura do proxy da Netlify (F4);
 *  7. rate limit com store compartilhado (só quando há store; ver `HttpOptions.rateLimit`);
 *  8. Better Auth (F4);
 *  9. Swagger + Scalar em `/api/docs` (fora de produção);
 * 10. rotas;
 * 11. error handler RFC 9457 (registrado antes de tudo para valer em todos os escopos).
 */
export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    ...(deps.logger === undefined ? { logger: false } : { loggerInstance: deps.logger }),
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: fastifyTrustProxy(deps.http.trustProxy),
    requestIdHeader: false,
    genReqId: createRequestIdGenerator(deps.http.requestIdHeader),
    return503OnClosing: true,
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  registerProblemHandlers(app)
  decorateContainer(app, deps.container)
  registerRequestIdHeader(app)

  await registerUnderPressure(app, { eventLoopDelayGuard: deps.http.eventLoopDelayGuard })
  await registerSecurityHeaders(app)
  registerApiCacheControl(app)
  if (deps.http.rateLimit !== undefined) {
    await registerRateLimit(app, deps.http.rateLimit)
  }
  await app.register(sensible)

  if (deps.http.docs) {
    await registerOpenApi(app, { version: deps.container.buildInfo.version })
  }

  await app.register(healthRoutes)
  if (deps.http.spike !== undefined) {
    // Rotas temporárias dos spikes da F1: só staging na Vercel (`createHttpOptions`).
    await app.register(spikeRoutes(deps.http.spike))
  }
  await app.register(streamScope, { prefix: STREAM_PREFIX, webOrigin: deps.http.webOrigin })

  return app
}
