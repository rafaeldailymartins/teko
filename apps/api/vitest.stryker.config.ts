import { defineConfig } from 'vitest/config'

/**
 * Config usada só pelo Stryker: os testes unitários, sem cobertura, sem projetos e sem o
 * reporter JUnit (o Stryker instrumenta o código e roda cada mutante isoladamente).
 */
export default defineConfig({
  test: {
    name: 'api-stryker',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    reporters: ['default'],
  },
})
