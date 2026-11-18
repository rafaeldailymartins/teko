/**
 * Monta o `.vercel/output` (Build Output API v3) do projeto Vercel único do Tekó: o export
 * estático do Next (`apps/web/out`) em `static/` e a API, a partir do bundle do tsdown, numa só
 * Function (ADR 0017 e ADR 0029, web e API na mesma origem). O builder zero-config do Fastify não
 * serve: ele compila `src/server.ts` mantendo os imports relativos com extensão `.ts`, e a Function
 * cai no boot com `ERR_MODULE_NOT_FOUND`; o bundle do tsdown já resolve os subpath imports e embute
 * `@teko/shared`.
 *
 * Saída:
 *
 *   .vercel/output/
 *     config.json                         version 3 + rotas escritas à mão (`outputConfig`), com a
 *                                         CSP de cada documento do manifesto do export
 *     static/                             cópia de `apps/web/out` (HTML, CSS, JS, fontes), sem o
 *                                         manifesto `.teko-headers.json`
 *     functions/index.func/
 *       .vc-config.json                   nodejs24.x, launcher Nodejs, streaming, maxDuration
 *       server.mjs (+ chunks), *.map      `apps/api/dist` (tsdown): o handler e o que ele importa
 *       node_modules/                     dependências de produção da API
 *
 * Só `/api/*` e `/healthz` chegam à Function; o resto é servido pela CDN a partir de `static/`. As
 * rotas ficam escritas aqui, sem o `@vercel/routing-utils` (sem proveniência; ADR 0002), e o
 * `scripts/build-vercel-output.test.ts` fixa cada uma.
 *
 * O handler é o próprio `server.mjs`, sem entrypoint de plataforma: o launcher `Nodejs` da Vercel
 * troca `http.Server.prototype.listen` por um interceptador, importa o módulo e encaminha as
 * requisições ao servidor capturado (o mesmo protocolo que o zero-config usa com `server.js`;
 * `apps/api/test/integration/server.test.ts` o reproduz). A região vem do projeto (`gru1`).
 *
 * Uso (no runner do Actions ou local), depois de:
 *
 *   pnpm --filter @teko/web build
 *   pnpm --filter @teko/api build
 *   pnpm --filter @teko/api --prod deploy --ignore-scripts --config.node-linker=hoisted dist/vercel/api-prod
 *   node scripts/build-vercel-output.ts
 *
 * Não aceita argumento algum: todos os caminhos são constantes derivadas da raiz do repositório
 * (ver `scripts/lib/cli-guards.ts`). O `node-linker=hoisted` deixa o `node_modules` sem links
 * simbólicos (só os `.bin`, que ficam de fora); um link simbólico nas dependências ou no export
 * derruba o script. Ficam de fora também os metadados do pnpm (`.pnpm`, `.modules.yaml` etc.) e o
 * `@teko/shared`, que já está no bundle. Argumento na linha de comando termina com código 2;
 * falha de montagem, com 1. Não usa dependências: só o Node 24 (type stripping) e a política do site
 * estático (`scripts/lib/static-site-policy.ts`, sem imports), a mesma que o Caddy da stack de CI
 * usa.
 *
 * Identidade do commit (F7): com `GIT_SHA` (ou `GITHUB_SHA`, no Actions) no ambiente, o
 * `.vc-config.json` ganha `environment: { GIT_SHA, APP_VERSION }` (campo `environment` do Build
 * Output API v3: env vars da Function somadas às do projeto). Assim o tarball atestado carrega o
 * commit que o `/healthz` devolve e que o smoke confere, sem env var no projeto (o
 * `scripts/vercel-env-sync.ts` recusa `GIT_SHA` e `APP_VERSION` lá). O SHA precisa ter 40 hex e,
 * com ele, `APP_VERSION` (SemVer, sem `v`) é obrigatória; sem SHA nenhum (build local), a Function
 * sai sem `environment` e responde `gitSha: unknown`.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { compareCodeUnits, resolveInsideRoot } from './lib/cli-guards.ts'
import {
  ACCEPT_LANGUAGE_EN,
  type DocumentHeaders,
  documentPathPattern,
  HEADERS_MANIFEST_FILE,
  IMMUTABLE_CACHE_CONTROL,
  isSourceMapPath,
  parseHeadersManifest,
  ROOT_REDIRECT_HEADERS,
  STATIC_HEADERS,
  STATIC_LOCALES,
} from './lib/static-site-policy.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Nome da Function: `index` atende `/`, e as rotas da API mandam para lá. */
export const FUNCTION_NAME = 'index'

/** Arquivo do bundle que vira o handler da Function (entry `server` do `apps/api/tsdown.config.ts`). */
export const HANDLER = 'server.mjs'

/**
 * Duração máxima de uma invocação, em segundos: o teto de 100 s do stream mais 20 s de reserva para
 * a finalização (plano, Streaming). `FUNCTION_MAX_DURATION_S` é obrigatória com
 * `RUNTIME_TARGET=vercel` (sem padrão no `apps/api/src/config/env.ts`) e precisa ser igual a este
 * valor em `infra/vercel/env.*.json`; o teste `scripts/build-vercel-output.test.ts` confere.
 */
export const MAX_DURATION_S = 120

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
  // Sem isto, a Function não percebe o cliente indo embora: no spike F1 (b), um SSE de 60 s
  // abandonado aos 15 s rodou até o fim; com isto, request.signal e o close da resposta
  // dispararam aos 14,7 s (ADR 0003).
  supportsCancellation: true,
} as const

/** Commit e versão gravados na Function (lidos pela API em `GIT_SHA` e `APP_VERSION`). */
export interface BuildIdentity {
  /** SHA completo do commit (40 hex minúsculos). */
  readonly gitSha: string
  /** Versão SemVer sem `v` (`0.1.0`, `0.1.0-rc.1`, `0.0.0-abc1234`). */
  readonly version: string
}

const FULL_GIT_SHA = /^[0-9a-f]{40}$/
/** SemVer 2.0 sem `v` (o mesmo `releaseVersionSchema` de `apps/api/src/domain/shared/build-info.ts`). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

/**
 * Identidade do build a partir do ambiente: `GIT_SHA` (ou `GITHUB_SHA`) e `APP_VERSION`. Sem SHA,
 * `undefined` (build local); SHA ou versão fora do formato, ou versão ausente com SHA, lançam.
 */
export function buildIdentityFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): BuildIdentity | undefined {
  const pick = (name: string): string | undefined => {
    const value = env[name]?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const gitSha = pick('GIT_SHA') ?? pick('GITHUB_SHA')
  const version = pick('APP_VERSION')
  if (gitSha === undefined) {
    if (version !== undefined) {
      throw new BuildOutputError('APP_VERSION sem GIT_SHA (nem GITHUB_SHA)')
    }
    return undefined
  }
  if (!FULL_GIT_SHA.test(gitSha)) {
    throw new BuildOutputError('GIT_SHA (ou GITHUB_SHA) precisa ter 40 caracteres hex minúsculos')
  }
  if (version === undefined || !SEMVER.test(version)) {
    throw new BuildOutputError(
      'APP_VERSION precisa ser SemVer sem "v" (ex.: 0.1.0-rc.1) com GIT_SHA',
    )
  }
  return { gitSha, version }
}

/** `.vc-config.json` da Function, com a identidade do commit em `environment` quando há uma. */
export function vcConfig(identity?: BuildIdentity) {
  return identity === undefined
    ? VC_CONFIG
    : {
        ...VC_CONFIG,
        environment: { GIT_SHA: identity.gitSha, APP_VERSION: identity.version },
      }
}

/**
 * Domínios antigos (`teko-api*.vercel.app`, de antes da renomeação dos projetos) → domínio canônico
 * do mesmo projeto. O cookie de sessão e o `rpID` das passkeys dependem de um host único, então os
 * antigos só redirecionam (308, preserva método e corpo). Cada projeto só tem o próprio domínio
 * antigo; as duas regras no mesmo `config.json` não se cruzam.
 */
export const LEGACY_HOST_REDIRECTS = [
  { from: 'teko-api.vercel.app', to: 'https://tekoia.vercel.app' },
  { from: 'teko-api-staging.vercel.app', to: 'https://tekoia-staging.vercel.app' },
] as const

/** Caminhos da API (Function `index`); tudo o mais é estático. */
export const API_PATH_PATTERN = '^/(api(?:/.*)?|healthz)$'
/**
 * Caminho da Function `functions/index.func` no filesystem do Build Output. A rota da API reescreve
 * para ele (nunca para `/`, que é a página de entrada e o redirect por idioma), e as rotas do
 * estático o deixam de fora: o transform `request.path` não encerra o roteamento, então as rotas
 * seguintes ainda casam o caminho reescrito (com `dest: '/'`, o primeiro deploy da F7 devolvia o 302
 * da raiz em `/healthz` e `/api/*`).
 */
export const FUNCTION_ROUTE = '/index'

/** Locales do export; o primeiro é o padrão (fonte: a política do site estático da API). */
const LOCALES = STATIC_LOCALES

/**
 * Rotas do `config.json`, na ordem em que a Vercel as avalia:
 *
 * 1. domínios antigos → canônico (308, antes de tudo, inclusive da API);
 * 2. `/api/*` e `/healthz` → Function `index` (`FUNCTION_ROUTE`), com o caminho original restaurado
 *    pelo transform `request.path`; o transform não encerra o roteamento, então as rotas abaixo
 *    deixam `/index` de fora e ele chega ao filesystem, onde está a Function;
 * 3. headers de segurança em todo o estático, a CSP de cada documento no caminho exato que o serve
 *    (sensível à caixa) e `/_next/static/*` imutável (`continue`);
 * 4. `/` → `/en/` ou `/pt-BR/` pelo `Accept-Language` (302; o `index.html` da raiz fica como página
 *    de entrada para quem não segue redirect);
 * 5. `/pt-br/...` (a grafia que a Netlify gerava) → `/pt-BR/...`;
 * 6. `trailingSlash: true` do Next: caminho sem extensão e sem barra final ganha a barra (308);
 * 7. `filesystem`: o arquivo do `static/` (o diretório serve o `index.html`);
 * 8. o que sobrou é 404: a página do locale do caminho, ou o `404.html` da raiz, cada uma com a CSP
 *    dela.
 *
 * Nenhuma resposta recebe o mesmo header de duas rotas: a CSP de um documento só casa caminhos que
 * existem no `static/`, e as rotas de 404 só valem para o que o filesystem não achou. Assim o
 * resultado não depende de como a Vercel combina headers repetidos.
 */
export function outputConfig(documents: DocumentHeaders) {
  const headersOf = (file: string): Readonly<Record<string, string>> => {
    const headers = documents[file]
    if (headers === undefined) {
      throw new BuildOutputError(`${HEADERS_MANIFEST_FILE} não tem os headers de ${file}`)
    }
    return headers
  }
  return {
    version: 3,
    routes: [
      ...LEGACY_HOST_REDIRECTS.map(({ from, to }) => ({
        src: '^/(.*)$',
        has: [{ type: 'host', value: from }],
        status: 308,
        headers: { Location: `${to}/$1` },
      })),
      {
        src: API_PATH_PATTERN,
        dest: FUNCTION_ROUTE,
        transforms: [{ type: 'request.path', op: 'set', args: '/$1' }],
      },
      { src: '^/(?!index$)(.*)$', headers: STATIC_HEADERS, continue: true },
      ...Object.keys(documents)
        .sort(compareCodeUnits)
        .map((file) => ({
          src: documentPathPattern(file),
          caseSensitive: true,
          headers: headersOf(file),
          continue: true,
        })),
      {
        src: '^/_next/static/(.*)$',
        headers: { 'Cache-Control': IMMUTABLE_CACHE_CONTROL },
        continue: true,
      },
      {
        src: '^/$',
        has: [{ type: 'header', key: 'accept-language', value: { re: ACCEPT_LANGUAGE_EN } }],
        status: 302,
        headers: { Location: '/en/', ...ROOT_REDIRECT_HEADERS },
      },
      {
        src: '^/$',
        status: 302,
        headers: { Location: `/${LOCALES[0]}/`, ...ROOT_REDIRECT_HEADERS },
      },
      {
        src: '^/pt-br(/.*)?$',
        caseSensitive: true,
        status: 308,
        headers: { Location: '/pt-BR$1' },
      },
      {
        src: '^/((?!\\.well-known/|index$)(?:[^/]+/)*[^/.]+)$',
        status: 308,
        headers: { Location: '/$1/' },
      },
      { handle: 'filesystem' },
      ...LOCALES.map((locale) => ({
        src: `^/${locale}(?:/.*)?$`,
        dest: `/${locale}/404/index.html`,
        status: 404,
        headers: headersOf(`${locale}/404/index.html`),
      })),
      { src: '^/.*$', dest: '/404.html', status: 404, headers: headersOf('404.html') },
    ],
  } as const
}

/** Arquivos que o export precisa ter (a raiz de entrada e as páginas de 404). */
export const REQUIRED_STATIC_FILES = [
  'index.html',
  '404.html',
  ...LOCALES.flatMap((locale) => [`${locale}/index.html`, `${locale}/404/index.html`]),
] as const

/**
 * Arquivos de configuração de outros hosts que não podem ir para o `static/` (ficariam públicos e
 * sem efeito): os da Netlify e qualquer `.env`.
 */
const FORBIDDEN_STATIC_NAME = /^(?:_redirects|_headers|netlify\.toml|\.env(?:\..*)?)$/

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
  /** Export estático do Next (`apps/web/out`). */
  readonly staticDir: string
  /** Diretório `.vercel/output` a (re)criar. */
  readonly outputDir: string
}

/**
 * Documentação Markdown das dependências (`README.md`, `CHANGELOG.md`, `docs/*.mdx`): não roda, e os
 * exemplos `NOME=valor` dela derrubam a checagem de env var do `pack-vercel-output.ts`. Licenças e
 * avisos ficam.
 */
const DEPENDENCY_DOC = /\.(?:md|mdx|markdown)$/i
const LICENSE_FILE = /^(?:licen[cs]e|notice|copying)/i

function skipped(name: string, topLevel: boolean): boolean {
  if (name === '.bin') {
    return true
  }
  if (!topLevel && DEPENDENCY_DOC.test(name) && !LICENSE_FILE.test(name)) {
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

/**
 * Copia o export estático, recusando links simbólicos e arquivos de configuração de outro host. O
 * manifesto de headers da raiz fica de fora (ele vira rotas), assim como os source maps (`*.map`,
 * enviados ao PostHog pelo deploy e nunca servidos; ADR 0037), e os HTML copiados vão para
 * `documents`.
 */
function copyStatic(from: string, to: string, documents: string[], relative = ''): number {
  mkdirSync(to, { recursive: true })
  let files = 0
  for (const name of readdirSync(from).sort(compareCodeUnits)) {
    const source = join(from, name)
    const target = join(to, name)
    const path = relative === '' ? name : `${relative}/${name}`
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) {
      throw new BuildOutputError(`link simbólico no export estático: ${path}`)
    }
    if (FORBIDDEN_STATIC_NAME.test(name)) {
      throw new BuildOutputError(`arquivo proibido no export estático: ${path}`)
    }
    if (path === HEADERS_MANIFEST_FILE || isSourceMapPath(name)) {
      continue
    }
    if (stat.isDirectory()) {
      files += copyStatic(source, target, documents, path)
    } else if (stat.isFile()) {
      copyFileSync(source, target)
      if (path.endsWith('.html')) {
        documents.push(path)
      }
      files += 1
    } else {
      throw new BuildOutputError(`tipo de arquivo não suportado no export estático: ${path}`)
    }
  }
  return files
}

/**
 * Imports relativos de um módulo do bundle: `from "./x.mjs"`, `import "./x.mjs"` e
 * `import("./x.mjs")`, como o tsdown (rolldown) os emite para os chunks compartilhados.
 */
const RELATIVE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])\.\/([A-Za-z0-9._-]+\.mjs)\1/g

/**
 * O handler e todos os chunks que ele importa, direta ou indiretamente (estática ou
 * dinamicamente). O tsdown gera chunks compartilhados entre `server.mjs` e `cli.mjs`
 * (`composition-root-<hash>.mjs`, ...); levar só o `server.mjs` derrubaria a Function no boot com
 * `ERR_MODULE_NOT_FOUND`. Ficam de fora o `cli.mjs` e o que só a CLI importa.
 */
export function bundleClosure(bundleDir: string, entry: string): string[] {
  const seen = new Set<string>()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (file === undefined || seen.has(file)) {
      continue
    }
    const path = join(bundleDir, file)
    if (!existsSync(path)) {
      throw new BuildOutputError(`${file} é importado pelo bundle, mas não existe em ${bundleDir}`)
    }
    seen.add(file)
    for (const match of readFileSync(path, 'utf8').matchAll(RELATIVE_IMPORT)) {
      if (match[2] !== undefined) {
        pending.push(match[2])
      }
    }
  }
  return [...seen].sort(compareCodeUnits)
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export interface BuildResult {
  readonly functionDir: string
  readonly dependencyFiles: number
  readonly staticFiles: number
}

function assertInputs(paths: BuildPaths, handler: string): void {
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
  const missing = [...REQUIRED_STATIC_FILES, HEADERS_MANIFEST_FILE].filter(
    (file) => !existsSync(join(paths.staticDir, file)),
  )
  if (missing.length > 0) {
    throw new BuildOutputError(
      `${paths.staticDir} não tem ${missing.join(', ')}; rode \`pnpm --filter @teko/web build\` antes`,
    )
  }
}

/** Manifesto de headers por documento do export, validado. */
function readDocumentHeaders(staticDir: string): DocumentHeaders {
  try {
    return parseHeadersManifest(
      JSON.parse(readFileSync(join(staticDir, HEADERS_MANIFEST_FILE), 'utf8')),
    )
  } catch (error) {
    throw new BuildOutputError(error instanceof Error ? error.message : String(error))
  }
}

/** Todo HTML copiado tem CSP no manifesto, e o manifesto não cita HTML que não existe. */
function assertDocumentsCovered(documents: DocumentHeaders, copied: readonly string[]): void {
  const listed = new Set(Object.keys(documents))
  const uncovered = copied.filter((file) => !listed.has(file))
  const stale = [...listed].filter((file) => !copied.includes(file))
  if (uncovered.length > 0 || stale.length > 0) {
    throw new BuildOutputError(
      `${HEADERS_MANIFEST_FILE} não bate com o export (sem CSP: ${uncovered.join(', ') || '-'}; inexistentes: ${stale.join(', ') || '-'}); rode \`pnpm --filter @teko/web build\` de novo`,
    )
  }
}

/**
 * Recria `outputDir` com o `config.json`, o `static/` e a Function `index.func` (com a identidade
 * do commit no `.vc-config.json`, se houver).
 */
export function buildVercelOutput(paths: BuildPaths, identity?: BuildIdentity): BuildResult {
  const handler = join(paths.bundleDir, HANDLER)
  assertInputs(paths, handler)
  const documents = readDocumentHeaders(paths.staticDir)
  const config = outputConfig(documents)

  rmSync(paths.outputDir, { recursive: true, force: true })
  const functionDir = join(paths.outputDir, 'functions', `${FUNCTION_NAME}.func`)
  mkdirSync(functionDir, { recursive: true })
  writeJson(join(paths.outputDir, 'config.json'), config)
  writeJson(join(functionDir, '.vc-config.json'), vcConfig(identity))
  for (const file of bundleClosure(paths.bundleDir, HANDLER)) {
    copyFileSync(join(paths.bundleDir, file), join(functionDir, file))
    const sourceMap = join(paths.bundleDir, `${file}.map`)
    if (existsSync(sourceMap)) {
      copyFileSync(sourceMap, join(functionDir, `${file}.map`))
    }
  }
  const dependencyFiles = copyDependencies(paths.nodeModulesDir, join(functionDir, 'node_modules'))
  const copied: string[] = []
  const staticFiles = copyStatic(paths.staticDir, join(paths.outputDir, 'static'), copied)
  assertDocumentsCovered(documents, copied)
  return { functionDir, dependencyFiles, staticFiles }
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
  const identity = buildIdentityFromEnv(process.env)
  const result = buildVercelOutput(
    {
      bundleDir: inside('apps', 'api', 'dist'),
      nodeModulesDir: inside('dist', 'vercel', 'api-prod', 'node_modules'),
      staticDir: inside('apps', 'web', 'out'),
      outputDir: inside('.vercel', 'output'),
    },
    identity,
  )
  console.log(
    JSON.stringify({
      function: `functions/${FUNCTION_NAME}.func`,
      runtime: VC_CONFIG.runtime,
      maxDuration: VC_CONFIG.maxDuration,
      gitSha: identity?.gitSha ?? 'unknown',
      version: identity?.version ?? null,
      dependencyFiles: result.dependencyFiles,
      staticFiles: result.staticFiles,
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
