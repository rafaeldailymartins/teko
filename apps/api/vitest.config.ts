import { defineConfig } from 'vitest/config'

/**
 * Dois projetos (`vitest run --project <nome>`); os projects inline herdam a config da raiz
 * (padrão do Vitest 5), por isso não há `extends`.
 *
 * - `unit`: `src/**\/*.test.ts`, rápidos e sem I/O externo. É o único medido por cobertura
 *   (`test:unit` passa `--coverage`) e o único que o Stryker roda.
 * - `integration`: `test/integration/**\/*.test.ts`, a app inteira via `app.inject()` sobre
 *   `buildApp` (Testcontainers com Postgres a partir da F2).
 *
 * Cobertura (v8), thresholds do plano: `domain/**` e `application/**` 95/90/95/95 por arquivo;
 * `adapters/**` 80/70/80/80 no agregado.
 */
const STRICT_THRESHOLDS = {
  lines: 95,
  branches: 90,
  functions: 95,
  statements: 95,
  perFile: true,
} as const

export default defineConfig({
  test: {
    environment: 'node',
    reporters: ['default', 'junit'],
    // `test:integration` sobrescreve com --outputFile.junit=reports/junit-integration.xml.
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // `server.ts` é o entrypoint (efeitos no topo do módulo); a integração o exercita.
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        'src/domain/**': STRICT_THRESHOLDS,
        'src/application/**': STRICT_THRESHOLDS,
        'src/adapters/**': { lines: 80, branches: 70, functions: 80, statements: 80 },
      },
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
    ],
  },
})
