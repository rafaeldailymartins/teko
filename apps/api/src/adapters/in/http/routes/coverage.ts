import { coverageResponseSchema } from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

/**
 * `GET /api/v1/coverage`: pública (sem sessão) e sem rate limit da aplicação. Responde do cache em
 * memória de 10 min da instância (`CoverageSource`), que é também o smoke de banco do deploy: a
 * primeira chamada de uma instância lê o Neon. Sem banco configurado, 503 `service_paused`.
 */
export const coverageRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/v1/coverage',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'getCoverage',
        summary: 'Cobertura efetiva do corpus por família',
        tags: ['corpus'],
        response: { 200: coverageResponseSchema, 503: problemDetailsSchema },
      },
    },
    async () => {
      const retrieval = app.container.useCases.retrieval
      if (retrieval === null) {
        throw app.httpErrors.serviceUnavailable()
      }
      return retrieval.getCoverage()
    },
  )
}
