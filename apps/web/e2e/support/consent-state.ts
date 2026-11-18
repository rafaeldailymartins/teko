import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'

/**
 * Estado inicial do navegador com a escolha de consentimento já feita (recusa), na versão vigente
 * da política. Assim o banner LGPD, fixo no rodapé da janela, não cobre o que as jornadas clicam,
 * e o PostHog de produto fica desligado. Usado pelo e2e (`playwright.config.ts`, menos o
 * `consent.spec.ts`, que começa sem estado) e pelo system test (`playwright.system.config.ts`).
 */
export function consentDecided(baseURL: string) {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          {
            name: 'teko-consent',
            value: JSON.stringify({
              policyVersion: PRIVACY_POLICY_VERSION,
              decidedAt: '2026-11-15T00:00:00.000Z',
              choices: { analytics: false, surveys: false },
            }),
          },
        ],
      },
    ],
  }
}
