/**
 * Monta o `.vercel/output` (Build Output API v3) da API a partir do bundle do tsdown, no lugar do
 * builder zero-config do Fastify (spike F1 (b), ADR 0017). O zero-config compila `src/server.ts`
 * mantendo os imports relativos com extensão `.ts`, e a Function cai no boot com
 * `ERR_MODULE_NOT_FOUND`; o bundle do tsdown já resolve os subpath imports e embute
 * `@teko/shared`.
 *
 * Saída (uma só Function, que recebe todas as rotas):
 *
 *   .vercel/output/
 *     config.json                         version 3 + rotas (filesystem, depois tudo para `/`)
 *     functions/index.func/
 *       .vc-config.json                   nodejs24.x, launcher Nodejs, streaming, maxDuration
 *       server.mjs, server.mjs.map        `apps/api/dist` (tsdown)
 *       node_modules/                     dependências de produção da API
 *
 * O handler é o próprio `server.mjs`, sem entrypoint de plataforma: o launcher `Nodejs` da Vercel
 * troca `http.Server.prototype.listen` por um interceptador, importa o módulo e encaminha as
 * requisições ao servidor capturado (o mesmo protocolo que o zero-config usa com `server.js`;
 * `apps/api/test/integration/server.test.ts` o reproduz). A região vem do projeto (`gru1`).
 *
 * Uso (no runner do Actions ou local), depois de:
 *
 *   pnpm --filter @teko/api build
 *   pnpm --filter @teko/api --prod deploy --ignore-scripts --config.node-linker=hoisted dist/vercel/api-prod
 *   node scripts/build-vercel-output.ts
 *
 * Não aceita argumento algum: todos os caminhos são constantes derivadas da raiz do repositório
 * (ver `scripts/lib/cli-guards.ts`). O `node-linker=hoisted` deixa o `node_modules` sem links
 * simbólicos (só os `.bin`, que ficam de fora); um link simbólico nas dependências derruba o
 * script. Ficam de fora também os metadados do pnpm (`.pnpm`, `.modules.yaml` etc.) e o
 * `@teko/shared`, que já está no bundle. Argumento na linha de comando termina com código 2;
 * falha de montagem, com 1. Não usa dependências: só o Node 24 (type stripping).
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { compareCodeUnits, resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Nome da Function: `index` atende `/`, e a rota catch-all manda tudo para lá. */
export const FUNCTION_NAME = 'index'

/** Arquivo do bundle que vira o handler da Function (entry `server` do `apps/api/tsdown.config.ts`). */
export const HANDLER = 'server.mjs'

/**
 * Duração máxima de uma invocação, em segundos. Precisa ser igual a `FUNCTION_MAX_DURATION_S` em
 * `infra/vercel/env.*.json` (a API calcula o prazo de cada invocação a partir dela); o teste
 * `scripts/build-vercel-output.test.ts` confere. Os 120 s com `supportsCancellation` do plano só
 * entram depois da conferência manual de desconexão do spike F1 (b).
 */
export const MAX_DURATION_S = 300

/** `.vc-config.json` da Function (Build Output API v3, launcher Node.js). */
export const VC_CONFIG = {
  runtime: 'nodejs24.x',
  handler: HANDLER,
  launcherType: 'Nodejs',
  // O Fastify faz o parse do corpo e as respostas; os helpers do launcher (`req.body`, `res.json`)
  // só tocariam no request antes do servidor capturado.
  shouldAddHelpers: false,
  shouldAddSourcemapSupport: true,
  // O SSE das perguntas (F4) precisa sair sem buffering.
  supportsResponseStreaming: true,
  maxDuration: MAX_DURATION_S,
} as const

/**
 * Rotas do `config.json`: primeiro os arquivos estáticos (não há nenhum), depois tudo vai para a
 * Function com o caminho original restaurado, como o builder zero-config do Fastify faz.
 */
export const OUTPUT_CONFIG = {
  version: 3,
  routes: [
    { handle: 'filesystem' },
    {
      src: '/(.*)',
      dest: '/',
      transforms: [{ type: 'request.path', op: 'set', args: '/$1' }],
    },
  ],
} as const

/** Entradas do topo do `node_modules` que não vão para a Function. */
const SKIPPED_TOP_LEVEL = new Set(['.bin', '.pnpm', '.modules.yaml', '@teko'])
/** Metadados do pnpm no topo (`.pnpm-workspace-state-v1.json` e afins). */
const PNPM_STATE_FILE = /^\.pnpm-.*$/

export class BuildOutputError extends Error {}
class UsageError extends Error {}

export interface BuildPaths {
  /** Diretório do bundle do tsdown (`apps/api/dist`). */
  readonly bundleDir: string
  /** `node_modules` das dependências de produção (`pnpm deploy --prod`, linker hoisted). */
  readonly nodeModulesDir: string
  /** Diretório `.vercel/output` a (re)criar. */
  readonly outputDir: string
}

function skipped(name: string, topLevel: boolean): boolean {
  if (name === '.bin') {
    return true
  }
  return topLevel && (SKIPPED_TOP_LEVEL.has(name) || PNPM_STATE_FILE.test(name))
}

/** Copia a árvore de dependências, sem `.bin`, metadados do pnpm nem links simbólicos. */
function copyDependencies(from: string, to: string, topLevel = true, relative = ''): number {
  mkdirSync(to, { recursive: true })
  let files = 0
  for (const name of readdirSync(from).sort(compareCodeUnits)) {
    if (skipped(name, topLevel)) {
      continue
    }
    const source = join(from, name)
    const target = join(to, name)
    const path = relative === '' ? name : `${relative}/${name}`
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) {
      throw new BuildOutputError(
        `link simbólico em node_modules/${path}; gere as dependências com --config.node-linker=hoisted`,
      )
    }
    if (stat.isDirectory()) {
      files += copyDependencies(source, target, false, path)
    } else if (stat.isFile()) {
      copyFileSync(source, target)
      files += 1
    } else {
      throw new BuildOutputError(`tipo de arquivo não suportado em node_modules/${path}`)
    }
  }
  return files
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export interface BuildResult {
  readonly functionDir: string
  readonly dependencyFiles: number
}

/** Recria `outputDir` com o `config.json` e a Function `index.func`. */
export function buildVercelOutput(paths: BuildPaths): BuildResult {
  const handler = join(paths.bundleDir, HANDLER)
  if (!existsSync(handler)) {
    throw new BuildOutputError(
      `${handler} não existe; rode \`pnpm --filter @teko/api build\` antes`,
    )
  }
  if (!existsSync(join(paths.nodeModulesDir, 'fastify', 'package.json'))) {
    throw new BuildOutputError(
      `${paths.nodeModulesDir} não tem as dependências de produção da API; rode o \`pnpm deploy --prod\` antes`,
    )
  }

  rmSync(paths.outputDir, { recursive: true, force: true })
  const functionDir = join(paths.outputDir, 'functions', `${FUNCTION_NAME}.func`)
  mkdirSync(functionDir, { recursive: true })
  writeJson(join(paths.outputDir, 'config.json'), OUTPUT_CONFIG)
  writeJson(join(functionDir, '.vc-config.json'), VC_CONFIG)
  copyFileSync(handler, join(functionDir, HANDLER))
  const sourceMap = `${handler}.map`
  if (existsSync(sourceMap)) {
    copyFileSync(sourceMap, join(functionDir, `${HANDLER}.map`))
  }
  const dependencyFiles = copyDependencies(paths.nodeModulesDir, join(functionDir, 'node_modules'))
  return { functionDir, dependencyFiles }
}

function main(): void {
  try {
    parseArgs({ options: {}, strict: true, allowPositionals: false })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  // Defesa em profundidade: nenhum link simbólico leva leitura ou escrita para fora do repositório.
  const inside = (...segments: string[]) =>
    resolveInsideRoot(REPO_ROOT, join(REPO_ROOT, ...segments), REPO_ROOT)
  const result = buildVercelOutput({
    bundleDir: inside('apps', 'api', 'dist'),
    nodeModulesDir: inside('dist', 'vercel', 'api-prod', 'node_modules'),
    outputDir: inside('.vercel', 'output'),
  })
  console.log(
    JSON.stringify({
      function: `functions/${FUNCTION_NAME}.func`,
      runtime: VC_CONFIG.runtime,
      maxDuration: VC_CONFIG.maxDuration,
      dependencyFiles: result.dependencyFiles,
    }),
  )
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`build-vercel-output: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof UsageError) {
      console.error('uso: node scripts/build-vercel-output.ts (sem argumentos)')
    }
    // `exitCode` em vez de `exit()`: no Windows, sair com a escrita no stderr ainda pendente aborta
    // o Node (assert do libuv) e troca o código de saída.
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
