import { HealthStatus, healthResponseSchema } from '@teko/shared/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

/**
 * Liveness: `GET /healthz` (smoke do deploy, monitor externo, healthcheck da stack de CI e do
 * Render) e `GET /api/healthz` (o mesmo, sob o prefixo da API que a web usa). Só reflete o estado
 * do processo e **nunca** toca o banco, para que pings externos nunca acordem o Neon. Fora da
 * Vercel, em drenagem (SIGTERM), responde 503 com `status: 'draining'`.
 *
 * Sem rate limit e com log só a partir de `warn`, para não inundar os logs com uma linha por
 * checagem.
 */
const HEALTH_ROUTES = [
  { url: '/healthz', operationId: 'getHealthDirect', summary: 'Liveness (infraestrutura)' },
  { url: '/api/healthz', operationId: 'getHealth', summary: 'Liveness (prefixo da API)' },
] as const

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  for (const route of HEALTH_ROUTES) {
    app.get(
      route.url,
      {
        logLevel: 'warn',
        config: { rateLimit: false },
        schema: {
          operationId: route.operationId,
          summary: route.summary,
          tags: ['health'],
          response: { 200: healthResponseSchema, 503: healthResponseSchema },
        },
      },
      async (_request, reply) => {
        const health = app.container.useCases.getHealth()
        return reply.code(health.status === HealthStatus.Ok ? 200 : 503).send(health)
      },
    )
  }
}
