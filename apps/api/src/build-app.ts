import sensible from '@fastify/sensible'
import { AppEnv } from '@teko/shared/contracts'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { BODY_LIMIT_BYTES, type HttpOptions } from '#adapters/in/http/http-options.ts'
import { registerAuth } from '#adapters/in/http/plugins/auth.ts'
import { decorateContainer } from '#adapters/in/http/plugins/container.ts'
import {
  registerRateLimit,
  registerUnderPressure,
} from '#adapters/in/http/plugins/load-protection.ts'
import { registerOpenApi } from '#adapters/in/http/plugins/openapi.ts'
import { registerOriginGuard } from '#adapters/in/http/plugins/origin-guard.ts'
import {
  createRequestIdGenerator,
  registerRequestIdHeader,
} from '#adapters/in/http/plugins/request-id.ts'
import {
  registerApiCacheControl,
  registerSecurityHeaders,
} from '#adapters/in/http/plugins/security-headers.ts'
import { registerProblemHandlers } from '#adapters/in/http/problem/error-handler.ts'
import { coverageRoutes } from '#adapters/in/http/routes/coverage.ts'
import { evalRoutes } from '#adapters/in/http/routes/eval.ts'
import { healthRoutes } from '#adapters/in/http/routes/health.ts'
import { meRoutes } from '#adapters/in/http/routes/me.ts'
import { provisionRoutes } from '#adapters/in/http/routes/provisions.ts'
import { registerStaticSite, staticNotFound } from '#adapters/in/http/static-site/static-site.ts'
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
 *  6. checagem de `Origin` e `content-type` nos métodos que mudam estado em `/api/v1/*` (web e
 *     API na mesma origem, sem CORS, ADR 0029);
 *  7. rate limit com store compartilhado (só quando há store; ver `HttpOptions.rateLimit`);
 *  8. Better Auth (F4);
 *  9. Swagger + Scalar em `/api/docs` (fora de produção);
 * 10. rotas (as de eval só com `APP_ENV=ci`; e, só no Plano B, o export estático do web);
 * 11. error handler RFC 9457 (registrado antes de tudo para valer em todos os escopos).
 */
export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  if (deps.http.evalRoutes && deps.container.appEnv !== AppEnv.Ci) {
    // Asserção de boot: as rotas de eval nunca sobem fora da stack de CI.
    throw new Error(`rotas /api/v1/_eval/* proibidas com APP_ENV=${deps.container.appEnv}`)
  }
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
  registerProblemHandlers(app, deps.http.staticSite === undefined ? undefined : staticNotFound)
  decorateContainer(app, deps.container)
  registerRequestIdHeader(app)

  await registerUnderPressure(app, { eventLoopDelayGuard: deps.http.eventLoopDelayGuard })
  await registerSecurityHeaders(app)
  registerApiCacheControl(app)
  registerOriginGuard(app, { webOrigin: deps.http.webOrigin })
  if (deps.http.rateLimit !== undefined) {
    await registerRateLimit(app, deps.http.rateLimit)
  }
  await app.register(sensible)
  await registerAuth(app, { webOrigin: deps.http.webOrigin })

  if (deps.http.docs) {
    await registerOpenApi(app, { version: deps.container.buildInfo.version })
  }

  await app.register(healthRoutes)
  await app.register(coverageRoutes)
  await app.register(meRoutes)
  await app.register(provisionRoutes)
  if (deps.http.evalRoutes) {
    await app.register(evalRoutes)
  }
  if (deps.http.staticSite !== undefined) {
    await registerStaticSite(app, deps.http.staticSite)
  }

  return app
}
