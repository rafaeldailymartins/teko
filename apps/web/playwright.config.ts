import { defineConfig, devices } from '@playwright/test'
import { consentDecided } from './e2e/support/consent-state.ts'

const baseURL = process.env['E2E_BASE_URL'] ?? 'http://localhost:8080'

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
    // A escolha de consentimento já feita; o `consent.spec.ts` começa sem estado (primeira visita).
    storageState: consentDecided(baseURL),
    trace: 'retain-on-failure',
    // A stack builda com chaves fictícias do PostHog (`infra/ci/up.sh`): o DNS dos hosts dele não
    // resolve no navegador do teste, então nada sai para a rede real (nem o relatório de CSP, que o
    // navegador manda por conta própria). As jornadas que olham o PostHog interceptam os pedidos
    // com `page.route`, que responde antes da resolução.
    launchOptions: { args: ['--host-resolver-rules=MAP *.posthog.com ~NOTFOUND'] },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
