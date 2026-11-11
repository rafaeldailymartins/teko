import { defineConfig } from 'vitest/config'

/**
 * Config usada só pelo Stryker: os mesmos testes unitários, sem cobertura e sem o reporter JUnit
 * (o Stryker instrumenta o código e roda cada mutante isoladamente).
 */
export default defineConfig({
  test: {
    name: 'shared-stryker',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
})
