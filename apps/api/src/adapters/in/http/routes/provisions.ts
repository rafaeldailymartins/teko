import {
  provisionDiffQuerySchema,
  provisionDiffResponseSchema,
  provisionKeyParamsSchema,
  provisionSearchQuerySchema,
  provisionSearchResponseSchema,
  provisionTimelineResponseSchema,
} from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { ProvisionUseCases } from '#app/use-cases/provisions.ts'

/**
 * Paleta, linha do tempo e diff de dispositivos (`/api/v1/provisions*`). Leituras do corpus, com o
 * rate limit da aplicação (cada chamada abre conexão no Neon). Sem banco configurado, 503.
 */
const ERRORS = { 404: problemDetailsSchema, 429: problemDetailsSchema, 503: problemDetailsSchema }

export const provisionRoutes: FastifyPluginAsyncZod = async (app) => {
  function provisions(): ProvisionUseCases {
    const retrieval = app.container.useCases.retrieval
    if (retrieval === null) {
      throw app.httpErrors.serviceUnavailable()
    }
    return retrieval.provisions
  }

  app.get(
    '/api/v1/provisions',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'searchProvisions',
        summary: 'Busca de dispositivos vigentes numa data (paleta)',
        tags: ['corpus'],
        querystring: provisionSearchQuerySchema,
        response: { 200: provisionSearchResponseSchema, ...ERRORS },
      },
    },
    async (request) => provisions().search(request.query),
  )

  app.get(
    '/api/v1/provisions/:stableKey/timeline',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'getProvisionTimeline',
        summary: 'Redações do dispositivo ao longo do tempo',
        tags: ['corpus'],
        params: provisionKeyParamsSchema,
        response: { 200: provisionTimelineResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const timeline = await provisions().timeline(request.params.stableKey)
      if (timeline === null) {
        throw app.httpErrors.notFound('Provision not found')
      }
      return timeline
    },
  )

  app.get(
    '/api/v1/provisions/:stableKey/diff',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'getProvisionDiff',
        summary: 'Diferença entre as redações vigentes em duas datas',
        tags: ['corpus'],
        params: provisionKeyParamsSchema,
        querystring: provisionDiffQuerySchema,
        response: { 200: provisionDiffResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const { from, to } = request.query
      const diff = await provisions().diff(request.params.stableKey, from, to)
      if (diff === null) {
        throw app.httpErrors.notFound('Provision not found')
      }
      return diff
    },
  )
}
