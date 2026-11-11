import { z } from 'zod'

/**
 * `POST /api/v1/me/onboarding`: declaração de maioridade, aceite da versão dos Termos e país de
 * residência (que alimenta a política regional de provedores).
 */
export const onboardingRequestSchema = z
  .strictObject({
    isAdult: z.literal(true),
    termsVersion: z
      .string()
      .regex(/^[0-9A-Za-z.-]{1,32}$/)
      .meta({ example: '2026-11-01' }),
    /** ISO 3166-1 alpha-2, em maiúsculas. */
    countryOfResidence: z.string().regex(/^[A-Z]{2}$/),
  })
  .meta({ description: 'Conclusão do onboarding (18+, termos e país de residência)' })

export type OnboardingRequest = z.infer<typeof onboardingRequestSchema>
