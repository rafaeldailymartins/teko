import { meResponseSchema, onboardingRequestSchema } from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { UserUseCases } from '#app/use-cases/users.ts'
import { requireSession } from '../plugins/auth.ts'

/**
 * Perfil e onboarding (`/api/v1/me*`). As rotas de DSR (`GET /me/export`, `DELETE /me`) e a cota
 * (`GET /me/quota`) entram com as mudanças de privacidade e de cotas.
 */
const ERRORS = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  503: problemDetailsSchema,
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  function users(): UserUseCases {
    const useCases = app.container.useCases.users
    if (useCases === null) {
      throw app.httpErrors.serviceUnavailable()
    }
    return useCases
  }

  app.get(
    '/api/v1/me',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'getMe',
        summary: 'Usuário da sessão e estado do onboarding',
        tags: ['me'],
        response: { 200: meResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireSession(request)
      return users().me(session.user)
    },
  )

  app.post(
    '/api/v1/me/onboarding',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'completeOnboarding',
        summary: 'Declara 18+, aceita a versão vigente dos Termos e informa o país de residência',
        tags: ['me'],
        body: onboardingRequestSchema,
        response: { 200: meResponseSchema, ...ERRORS },
      },
    },
    async (request) => {
      const session = await requireSession(request)
      return users().completeOnboarding(session.user, request.body)
    },
  )
}
