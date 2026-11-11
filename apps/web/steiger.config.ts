import fsd from '@feature-sliced/steiger-plugin'
import { defineConfig } from 'steiger'

/**
 * Feature-Sliced Design em `src/`. Além do `recommended`, imports entre slices da mesma camada e
 * imports relativos/absolutos fora do lugar são erro (plano: `no-cross-imports` e
 * `import-locality`). O código gerado (hey-api) e os testes não entram na análise.
 */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      'fsd/no-cross-imports': 'error',
      'fsd/import-locality': 'error',
    },
  },
  {
    ignores: ['**/__generated__/**', '**/*.test.ts', '**/*.test.tsx'],
  },
])
