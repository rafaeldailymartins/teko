import { meExportSchema, meResponseSchema, onboardingRequestSchema } from '@teko/shared/contracts'
import { problemDetailsSchema } from '@teko/shared/errors'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { PrivacyUseCases } from '#app/use-cases/privacy.ts'
import type { UserUseCases } from '#app/use-cases/users.ts'
import { requireSession } from '../plugins/auth.ts'

/**
 * Perfil, onboarding e direitos do titular (`/api/v1/me*`; a cota fica com as rotas de pergunta).
 * `GET /me/export` e `DELETE /me` leem a sessão do banco, nunca do `cookieCache`: uma sessão
 * revogada não exporta nem apaga.
 */
const ERRORS = {
  400: problemDetailsSchema,
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  503: problemDetailsSchema,
}

export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  function privacy(): PrivacyUseCases {
    const useCases = app.container.useCases.privacy
    if (useCases === null) {
      throw app.httpErrors.serviceUnavailable()
    }
    return useCases
  }

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

  app.get(
    '/api/v1/me/export',
    {
      config: { rateLimit: {} },
      schema: {
        operationId: 'exportMyData',
        summary: 'Exporta tudo o que o Tekó guarda do usuário (LGPD)',
        tags: ['me'],
        response: { 200: meExportSchema, ...ERRORS, 429: problemDetailsSchema },
      },
    },
    async (request, reply) => {
      const session = await requireSession(request, { fresh: true })
      const data = await privacy().exportMyData(session.user.id)
      return reply
        .header('content-disposition', 'attachment; filename="teko-meus-dados.json"')
        .send(data)
    },
  )

  app.delete(
    '/api/v1/me',
    {
      config: { rateLimit: false },
      schema: {
        operationId: 'deleteMyData',
        summary: 'Apaga a conta e tudo o que é dela (LGPD)',
        tags: ['me'],
        response: { 204: z.null(), ...ERRORS },
      },
    },
    async (request, reply) => {
      const session = await requireSession(request, { fresh: true })
      await privacy().deleteMyData(session.user.id)
      const auth = app.container.auth
      if (auth !== null) {
        reply.header('set-cookie', [...auth.clearSessionCookies()])
      }
      return reply.code(204).send(null)
    },
  )
}
