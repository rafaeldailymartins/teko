import { authProvidersResponseSchema } from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

/**
 * `GET /api/v1/auth/providers`: os métodos de entrada ativos no ambiente (ADR 0036), para a tela de
 * entrada mostrar só o que funciona (localmente, sem OAuth apps, ficam passkey e e-mail). Pública,
 * sem segredo, sem banco e sem rate limit da aplicação (o store dele acordaria o Neon); `no-store`
 * como todo `/api/*`. Sem o Better Auth configurado, 503 `service_paused`.
 */
export const authProviderRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/api/v1/auth/providers',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'getAuthProviders',
        summary: 'Métodos de entrada ativos no ambiente',
        tags: ['auth'],
        response: { 200: authProvidersResponseSchema, 503: problemDetailsSchema },
      },
    },
    async () => {
      const { auth } = app.container
      if (auth === null) {
        throw app.httpErrors.serviceUnavailable()
      }
      return { methods: [...auth.methods] }
    },
  )
}
