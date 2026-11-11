import { defineConfig } from 'tsdown'

/**
 * Bundle da API (`dist/*.mjs`, ESM para Node 24) para a Vercel, o Render (Plano B), a stack de CI
 * e o Docker local. Na Vercel, `scripts/build-vercel-output.ts` põe `dist/server.mjs` como handler
 * da única Function do Build Output API (`.vercel/output`), no lugar do builder zero-config do
 * Fastify, que mantinha os imports `.ts` e quebrava no boot (spike F1 (b), ADR 0017).
 *
 * - `server` é o único entrypoint HTTP (`src/server.ts`, o mesmo em todas as plataformas).
 * - As `dependencies` ficam externas (instaladas por `pnpm deploy --prod` na imagem e no
 *   `node_modules` da Function da Vercel).
 * - `@teko/shared` é um pacote interno que exporta `.ts` direto (sem build próprio): o Node não
 *   faz type stripping dentro de `node_modules`, então ele precisa ser embutido no bundle
 *   (`deps.alwaysBundle`, incluindo os subpaths `@teko/shared/<x>`).
 * - Os subpath imports (`#domain/*`, `#app/*`, `#adapters/*`) são resolvidos pelo bundler.
 * - A entry `cli` (`dist/cli.mjs`) entra com os subcomandos de ingestão e manutenção (F3).
 */
export default defineConfig({
  entry: {
    server: 'src/server.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  fixedExtension: true,
  deps: {
    alwaysBundle: [/^@teko\/shared(?:\/|$)/],
  },
})
