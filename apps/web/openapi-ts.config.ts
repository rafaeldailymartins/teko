import { defineConfig } from '@hey-api/openapi-ts'

/**
 * Cliente da API gerado do OpenAPI versionado (`openapi.json`, exportado por
 * `pnpm --filter @teko/api openapi:export`). O `baseUrl` vem do `servers[0]` do documento
 * (`/api`, mesma origem, ADR 0029); os caminhos ficam relativos a ele (`/v1/me`).
 *
 * Sem `postProcess`: o gerado fica fora do Biome (`!**\/__generated__` no `biome.json`) e o gate de
 * drift (`scripts/check-api-client.ts`) compara o resultado cru, que não depende de formatador.
 *
 * `// @ts-nocheck` no topo de cada arquivo: o runtime embutido do client-fetch não compila com o
 * `exactOptionalPropertyTypes` do `tsconfig.base.json`. Os tipos exportados continuam valendo para
 * quem importa (o `src/lib/api` e a UI são checados normalmente); só os erros internos do gerado
 * ficam de fora.
 */
export default defineConfig({
  input: './openapi.json',
  output: {
    path: './src/lib/api/__generated__',
    // Imports com `.ts`, como o resto do repositório: o Turbopack do `next build` não troca o `.js`
    // que o gerador põe por padrão pelo arquivo `.ts`, e o build falha ao importar o cliente.
    module: { extension: '.ts' },
    header: (ctx) => ['// @ts-nocheck', ...ctx.defaultValue],
  },
  plugins: [
    '@hey-api/client-fetch',
    '@hey-api/typescript',
    '@hey-api/sdk',
    { name: '@tanstack/react-query', queryOptions: true, queryKeys: true, mutationOptions: true },
  ],
})
