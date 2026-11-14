// @ts-check
/**
 * Regras de arquitetura da API (hexagonal). É o gate de dependências do pacote (o `turbo boundaries`
 * saiu, ADR 0032). Testes (`*.test.ts`) podem montar peças de camadas diferentes e ficam fora das
 * regras de camada, mas não das de ciclo e resolução.
 *
 * Os caminhos são os resolvidos: `@teko/shared` aparece como `../../packages/shared/...`
 * (symlink do workspace) e os pacotes npm como `../../node_modules/.pnpm/<pkg>@<v>/node_modules/<pkg>/...`,
 * que termina sempre em `node_modules/<pkg>/`.
 */

const TEST_FILE = '\\.test\\.ts$'
/**
 * Ferramentas fora da aplicação que montam peças como os testes: o provider das retrieval evals
 * (`createContainer` in-process) e o `fixtures:embed` (adapters de embedding e hash). Nunca entram
 * no bundle (o tsdown parte de `src/server.ts` e `src/cli.ts`).
 */
const EVALS = '^evals/'
const SHARED = '(^|/)packages/shared/'
/** @param {string} name */
const npm = (name) => `(^|/)node_modules/${name}/`
/** AI SDK da Vercel (núcleo e provedores Gemini e Groq; decisão do mantenedor em 2026-11-14). */
const LLM_SDKS = ['ai', '@ai-sdk/[^/]+'].map(npm).join('|')
const VERCEL_PACKAGES = npm('@vercel/[^/]+')
const PLATFORM_CONFIG = '^src/config/platform\\.ts$'

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment: 'src/domain só importa zod, @teko/shared e o próprio domínio.',
      severity: 'error',
      from: { path: '^src/domain/', pathNot: TEST_FILE },
      to: { pathNot: ['^src/domain/', SHARED, npm('zod')] },
    },
    {
      name: 'application-not-to-adapters',
      comment: 'src/application depende de portas, nunca de adapters.',
      severity: 'error',
      from: { path: '^src/application/', pathNot: TEST_FILE },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'core-not-to-frameworks',
      comment:
        'domain e application não conhecem Fastify, Drizzle, pg, SDKs de LLM, Better Auth nem @vercel/*.',
      severity: 'error',
      from: { path: '^src/(application|domain)/', pathNot: TEST_FILE },
      to: {
        path: [
          npm('fastify'),
          npm('@fastify/[^/]+'),
          npm('fastify-[^/]+'),
          npm('drizzle-orm'),
          npm('pg'),
          npm('better-auth'),
          LLM_SDKS,
          VERCEL_PACKAGES,
        ],
      },
    },
    {
      name: 'adapters-in-not-to-adapters-out',
      comment: 'Adapters de entrada falam com casos de uso, nunca com adapters de saída.',
      severity: 'error',
      from: { path: '^src/adapters/in/', pathNot: TEST_FILE },
      to: { path: '^src/adapters/out/' },
    },
    {
      name: 'adapters-out-only-from-composition-root',
      comment:
        'Só src/composition-root.ts instancia adapters de saída (e src/config/platform.ts, os de plataforma).',
      severity: 'error',
      from: {
        pathNot: [
          '^src/composition-root\\.ts$',
          PLATFORM_CONFIG,
          '^src/adapters/out/',
          TEST_FILE,
          EVALS,
        ],
      },
      to: { path: '^src/adapters/out/' },
    },
    {
      name: 'platform-config-only-platform-adapters',
      comment: 'src/config/platform.ts escolhe só os adapters de src/adapters/out/platform.',
      severity: 'error',
      from: { path: PLATFORM_CONFIG },
      to: { path: '^src/adapters/out/', pathNot: '^src/adapters/out/platform/' },
    },
    {
      name: 'composition-root-only-from-entrypoints',
      comment: 'A raiz de composição é importada só pelos entrypoints (server, cli).',
      severity: 'error',
      from: { pathNot: ['^src/(server|cli)\\.ts$', TEST_FILE, EVALS] },
      to: { path: '^src/composition-root\\.ts$' },
    },
    {
      name: 'config-only-from-roots',
      comment: 'Só os módulos da raiz de src/ leem o env; camadas recebem valores já validados.',
      severity: 'error',
      from: { path: '^src/(domain|application|adapters)/', pathNot: TEST_FILE },
      to: { path: '^src/config/' },
    },
    {
      name: 'llm-sdks-only-in-llm-adapters',
      comment: 'Os SDKs de LLM ficam só em src/adapters/out/llm.',
      severity: 'error',
      from: { pathNot: '^src/adapters/out/llm/' },
      to: { path: LLM_SDKS },
    },
    {
      name: 'vercel-only-in-vercel-adapter',
      comment:
        '@vercel/* (hoje só @vercel/functions 3.7.6) fica só em src/adapters/out/platform/vercel.',
      severity: 'error',
      from: { pathNot: '^src/adapters/out/platform/vercel/' },
      to: { path: VERCEL_PACKAGES },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Módulo que ninguém importa e que não importa nada é código morto.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: ['(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$', '\\.d\\.ts$', '(^|/)tsconfig\\.json$'],
      },
      to: {},
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Código de produção não importa devDependencies (só os testes).',
      severity: 'error',
      from: { path: '^src/', pathNot: TEST_FILE },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules', SHARED] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
