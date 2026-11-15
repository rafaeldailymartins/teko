import { defineConfig, devices } from '@playwright/test'
import { PRIVACY_POLICY_VERSION } from '@teko/shared/legal'

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:8080'

/**
 * Estado inicial das jornadas: a escolha de consentimento já feita (recusa), com a versão vigente
 * da política. Assim o banner LGPD, fixo no rodapé da janela, não cobre o que as outras jornadas
 * clicam. O `consent.spec.ts` começa sem estado nenhum (primeira visita).
 */
const consentDecided = {
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

/**
 * E2E contra a stack descartável de CI (`infra/ci`, `bash infra/ci/up.sh`): estático e API na mesma
 * origem, LLM e embeddings fake, e a sessão de teste em `E2E_SESSION_COOKIE`. Chromium e viewport
 * mobile (Pixel 7, também Chromium); sem Firefox nem WebKit (cortes de 2026-11-12). As jornadas de
 * interface entram com o front da F5; as da F4 cobrem a mesma origem, o login por cookie e a
 * pergunta com stream.
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 2,
  reporter: [['list'], ['junit', { outputFile: 'reports/junit-e2e.xml' }]],
  use: {
    baseURL,
    storageState: consentDecided,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
