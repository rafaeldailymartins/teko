import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Testes unitários de `@teko/web` (ambiente node na F1; o projeto de componentes em browser mode
 * chega com o Storybook). Thresholds do plano: `src/lib/**` 90/85 e global 80/75 (linhas/branches),
 * sem `src/app/**` (rotas do Next só reexportam), stories e `__generated__`. Estrutura (ADR 0029):
 * `src/app` (rotas), `src/components` (UI) e `src/lib` (lógica sem React).
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.tsx',
        'src/**/*.d.ts',
        'src/**/__generated__/**',
        'src/app/**',
        // Componentes de servidor assíncronos (next-intl/server, next/font) só rodam no build do
        // Next; ficam cobertos pelo build, pelos e2e e pelo axe. Eles saem daqui com o browser mode.
        'src/components/locale-layout.tsx',
        'src/components/landing-page.tsx',
        'src/components/not-found-page.tsx',
        'src/components/site-header.tsx',
        'src/components/site-footer.tsx',
        'src/components/locale-gateway/**',
        'src/lib/i18n/request.ts',
      ],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 80,
        branches: 75,
        'src/lib/**': { lines: 90, branches: 85 },
      },
    },
  },
})
