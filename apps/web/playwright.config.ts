import { defineConfig, devices } from '@playwright/test'

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
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
