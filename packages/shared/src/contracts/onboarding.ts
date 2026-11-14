import { z } from 'zod'
import { idSchema } from './common.ts'
import { questionDetailSchema } from './history.ts'

/**
 * `POST /api/v1/me/onboarding`: declaração de maioridade, aceite da versão dos Termos e país de
 * residência (que alimenta a política regional de provedores).
 */
export const termsVersionSchema = z
  .string()
  .regex(/^[0-9A-Za-z.-]{1,32}$/)
  .meta({ example: '2026-11-14' })

/** ISO 3166-1 alpha-2, em maiúsculas. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/)

export const onboardingRequestSchema = z
  .strictObject({
    isAdult: z.literal(true),
    termsVersion: termsVersionSchema,
    countryOfResidence: countryCodeSchema,
  })
  .meta({ description: 'Conclusão do onboarding (18+, termos e país de residência)' })

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>

/** `GET /api/v1/me` (e a resposta do onboarding): perfil e estado do onboarding. */
export const meResponseSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    onboarding: z.object({
      /** Falta concluir o onboarding (ou aceitar uma versão nova dos Termos). */
      required: z.boolean(),
      /** Versão dos Termos em vigor, que o onboarding precisa aceitar. */
      currentTermsVersion: termsVersionSchema,
      acceptedTermsVersion: termsVersionSchema.nullable(),
      countryOfResidence: countryCodeSchema.nullable(),
    }),
  })
  .meta({ description: 'Usuário da sessão' })

export type MeResponse = z.infer<typeof meResponseSchema>

/** `GET /api/v1/me/export`: tudo o que o Tekó guarda do usuário (LGPD, portabilidade). */
export const meExportSchema = z
  .object({
    exportedAt: z.iso.datetime({ offset: true }),
    user: z.object({
      id: idSchema,
      name: z.string(),
      email: z.string(),
      image: z.string().nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      isAdult: z.boolean(),
      termsVersion: z.string().nullable(),
      termsAcceptedAt: z.iso.datetime({ offset: true }).nullable(),
      countryOfResidence: z.string().nullable(),
    }),
    /** Provedores OAuth ligados à conta (sem tokens). */
    linkedAccounts: z.array(z.string()),
    passkeys: z.int().nonnegative(),
    questions: z.array(questionDetailSchema),
    feedback: z.array(
      z.object({
        questionId: idSchema,
        rating: z.string(),
        reason: z.string().nullable(),
        createdAt: z.iso.datetime({ offset: true }),
      }),
    ),
  })
  .meta({ description: 'Exportação dos dados do usuário' })

export type MeExport = z.infer<typeof meExportSchema>
