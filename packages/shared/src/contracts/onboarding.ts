import { z } from 'zod'
import { idSchema } from './common.ts'

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
