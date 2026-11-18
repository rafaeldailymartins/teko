import { defineConfig, devices } from '@playwright/test'
import { consentDecided } from './e2e/support/consent-state.ts'
import { STAGING_ORIGIN } from './system/support/passkey.ts'

/**
 * System test contra o staging real (`https://tekoia-staging.vercel.app`), fora da suíte e2e
 * (`playwright.config.ts` só olha `e2e/`): `pnpm --filter @teko/web test:system`, no
 * `.github/workflows/system-test.yml`. Chromium só (o autenticador virtual é do CDP), um worker e
 * nenhum retry: cada tentativa gasta cota de LLM do staging (no máximo 2 gerações por run). O host
 * é fixo: a passkey só vale no `rpID` do staging.
 */
export default defineConfig({
  testDir: './system',
  testMatch: '*.spec.ts',
  forbidOnly: true,
  retries: 0,
  workers: 1,
  // O stream tem teto de 100 s na API; o resto do roteiro cabe com folga no que sobra.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['junit', { outputFile: 'reports/junit-system.xml' }]],
  use: {
    baseURL: STAGING_ORIGIN,
    storageState: consentDecided(STAGING_ORIGIN),
    locale: 'pt-BR',
    // Traces e vídeos guardariam o cookie de sessão e as respostas do usuário de teste: só o
    // screenshot da falha sai como artifact.
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
