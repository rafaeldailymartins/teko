import { defineConfig } from 'vitest/config'

/**
 * Testes unitários e de propriedade de `@teko/shared`.
 * Os thresholds são os do plano para o pacote inteiro: 95/90/95/95 (linhas/branches/funções/statements).
 */
export default defineConfig({
  test: {
    name: 'shared',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: ['default', ['junit', { outputFile: 'reports/junit.xml' }]],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        statements: 95,
      },
    },
  },
})
