/**
 * Source maps do PostHog Error Tracking (ADR 0037) com o posthog-cli isolado em `tools/posthog-cli`
 * (instalado por `node tools/posthog-cli/install-binary.mjs`, com o sha256 conferido).
 *
 *   node scripts/sourcemaps.ts inject [--only web|api]
 *   node scripts/sourcemaps.ts upload --release-version <X.Y.Z|sha7> [--only web|api]
 *
 * Alvos (constantes; nenhum caminho vem da linha de comando):
 *
 * - `web`: os chunks do export estático (`apps/web/out/_next/static`, com os `.map` do
 *   `productionBrowserSourceMaps`; os `.map` nunca são servidos: a Vercel e o Caddy os deixam
 *   de fora);
 * - `api`: o bundle do tsdown (`apps/api/dist`), antes do `build-vercel-output`, que copia os `.mjs`
 *   já injetados para a Function.
 *
 * **`inject` é offline por construção.** O CLI só injeta sem rede quando não acha release nenhum:
 * com `--release-*`, com metadados do git do diretório de trabalho ou do CI ele chama a API do
 * PostHog para resolver o release (e falha sem credencial). Por isso o `inject` roda num diretório
 * temporário fora de qualquer repositório, com um ambiente mínimo (sem `GITHUB_*`), uma credencial
 * de mentira (o CLI exige uma, mesmo sem usar) e um proxy inalcançável: uma tentativa de rede falha
 * em vez de sair. O resultado são só os chunk ids (determinísticos, pelo conteúdo): o snippet que
 * registra `globalThis._posthogChunkIds` no topo de cada `.js`/`.mjs`, o comentário `//# chunkId=`
 * e o `chunk_id` no `.map`. Idempotente (o CLI pula o que já tem chunk id).
 *
 * **`upload`** roda no pipeline de deploy (F7), depois do `inject` e antes de publicar, com a chave
 * pessoal do PostHog (`POSTHOG_CLI_API_KEY`, escopos `error tracking write` e `organization read`)
 * e o `POSTHOG_CLI_PROJECT_ID`, no host da UE; o release é `teko@<versão>` (o mesmo
 * `errorTrackingRelease` da API e o `NEXT_PUBLIC_TEKO_RELEASE` do web). Composite pronta em
 * `.github/actions/posthog-sourcemaps`.
 *
 * Código de saída: 0 ok; 1 falha do CLI ou alvo sem build; 2 uso errado.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { compareCodeUnits, resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Nome do release no PostHog (o `RELEASE_NAME` de `apps/api/src/domain/shared/build-info.ts`). */
export const RELEASE_NAME = 'teko'

/** Host da API do PostHog na UE (o CLI usa o host do app, não o de ingestão). */
export const POSTHOG_EU_APP_HOST = 'https://eu.posthog.com'

/** Proxy que não existe: qualquer tentativa de rede do `inject` falha em vez de sair. */
export const UNREACHABLE_PROXY = 'http://127.0.0.1:9'

/** Credencial de mentira no formato que o CLI exige até para o `inject` (nunca é usada). */
const OFFLINE_KEY = 'phx_offline_inject_only'

export const TARGETS = {
  web: ['apps', 'web', 'out', '_next', 'static'],
  api: ['apps', 'api', 'dist'],
} as const
export type Target = keyof typeof TARGETS

/** Variáveis que o binário precisa para rodar (o resto do ambiente do CI fica de fora). */
const PASSTHROUGH_ENV = [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
] as const

/** Versão do release: SemVer (produção) ou SHA curto (staging). */
const RELEASE_VERSION = /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|[0-9a-f]{7,40})$/

class UsageError extends Error {}

type Env = Readonly<Record<string, string | undefined>>

function passthrough(source: Env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of PASSTHROUGH_ENV) {
    const value = source[name]
    if (value !== undefined) {
      env[name] = value
    }
  }
  return env
}

/** Ambiente do `inject`: mínimo, sem CI nem git, com credencial de mentira e rede bloqueada. */
export function offlineInjectEnv(source: Env): Record<string, string> {
  return {
    ...passthrough(source),
    POSTHOG_CLI_API_KEY: OFFLINE_KEY,
    POSTHOG_CLI_PROJECT_ID: '0',
    HTTPS_PROXY: UNREACHABLE_PROXY,
    HTTP_PROXY: UNREACHABLE_PROXY,
    ALL_PROXY: UNREACHABLE_PROXY,
    https_proxy: UNREACHABLE_PROXY,
    http_proxy: UNREACHABLE_PROXY,
    NO_PROXY: '',
    no_proxy: '',
  }
}

/** Ambiente do `upload`: as credenciais do PostHog e nada mais do CI. */
export function uploadEnv(source: Env): Record<string, string> {
  const key = source['POSTHOG_CLI_API_KEY']
  const project = source['POSTHOG_CLI_PROJECT_ID']
  if (key === undefined || !key.startsWith('phx_')) {
    throw new UsageError('POSTHOG_CLI_API_KEY (chave pessoal phx_…) ausente')
  }
  if (project === undefined || !/^\d+$/.test(project)) {
    throw new UsageError('POSTHOG_CLI_PROJECT_ID (número do projeto) ausente')
  }
  return { ...passthrough(source), POSTHOG_CLI_API_KEY: key, POSTHOG_CLI_PROJECT_ID: project }
}

export function injectArgs(directory: string): string[] {
  return ['sourcemap', 'inject', '--directory', directory]
}

export function uploadArgs(directory: string, releaseVersion: string): string[] {
  if (!RELEASE_VERSION.test(releaseVersion)) {
    throw new UsageError(`--release-version inválida: ${releaseVersion}`)
  }
  return [
    '--host',
    POSTHOG_EU_APP_HOST,
    'sourcemap',
    'upload',
    '--directory',
    directory,
    '--release-name',
    RELEASE_NAME,
    '--release-version',
    releaseVersion,
  ]
}

/** `.js`/`.mjs` de um diretório (recursivo), em ordem estável. */
export function scriptFiles(directory: string): string[] {
  const files: string[] = []
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    compareCodeUnits(a.name, b.name),
  )
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...scriptFiles(path))
    } else if (entry.isFile() && /\.m?js$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

const CHUNK_ID_COMMENT = /\n\/\/# chunkId=[0-9a-f-]{36}\s*$/

/** Arquivos com `.map` ao lado e sem o chunk id: o `inject` não pegou (ou não rodou). */
export function filesMissingChunkId(directory: string): string[] {
  return scriptFiles(directory).filter(
    (file) => existsSync(`${file}.map`) && !CHUNK_ID_COMMENT.test(readFileSync(file, 'utf8')),
  )
}

export function binaryPath(platform: NodeJS.Platform = process.platform): string {
  const name = platform === 'win32' ? 'posthog-cli.exe' : 'posthog-cli'
  return join(REPO_ROOT, 'tools', 'posthog-cli', 'bin', name)
}

function targetDirectory(target: Target): string {
  const directory = resolveInsideRoot(REPO_ROOT, join(REPO_ROOT, ...TARGETS[target]), REPO_ROOT)
  if (!existsSync(directory)) {
    throw new Error(`${directory} não existe; rode o build de ${target} antes`)
  }
  return directory
}

function run(args: readonly string[], env: Record<string, string>): void {
  const binary = binaryPath()
  if (!existsSync(binary)) {
    throw new Error(
      `${binary} não existe; rode \`pnpm --dir tools/posthog-cli install --frozen-lockfile\` e \`node tools/posthog-cli/install-binary.mjs\``,
    )
  }
  // Fora do repositório: o CLI lê o git do diretório de trabalho para achar um release.
  const cwd = mkdtempSync(join(tmpdir(), 'teko-sourcemaps-'))
  try {
    execFileSync(binary, args, { cwd, env, stdio: 'inherit' })
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

function inject(targets: readonly Target[]): void {
  for (const target of targets) {
    const directory = targetDirectory(target)
    run(injectArgs(directory), offlineInjectEnv(process.env))
    const missing = filesMissingChunkId(directory)
    if (missing.length > 0) {
      throw new Error(`sem chunk id depois do inject: ${missing.join(', ')}`)
    }
    console.log(JSON.stringify({ inject: target, files: scriptFiles(directory).length }))
  }
}

function upload(targets: readonly Target[], releaseVersion: string): void {
  const env = uploadEnv(process.env)
  for (const target of targets) {
    const directory = targetDirectory(target)
    const missing = filesMissingChunkId(directory)
    if (missing.length > 0) {
      throw new Error(`rode o inject antes do upload (${target}: ${missing.length} sem chunk id)`)
    }
    run(uploadArgs(directory, releaseVersion), env)
  }
}

function main(): void {
  let parsed: ReturnType<typeof parse>
  try {
    parsed = parse()
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const { mode, only, releaseVersion } = parsed
  const targets: Target[] = only === undefined ? ['web', 'api'] : [only]
  if (mode === 'inject') {
    inject(targets)
    return
  }
  if (releaseVersion === undefined) {
    throw new UsageError('upload exige --release-version')
  }
  upload(targets, releaseVersion)
}

function parse(): { mode: 'inject' | 'upload'; only?: Target; releaseVersion?: string } {
  const { positionals, values } = parseArgs({
    options: { only: { type: 'string' }, 'release-version': { type: 'string' } },
    strict: true,
    allowPositionals: true,
  })
  const [mode, ...rest] = positionals
  if ((mode !== 'inject' && mode !== 'upload') || rest.length > 0) {
    throw new Error('modo esperado: inject ou upload')
  }
  const only = values.only
  if (only !== undefined && only !== 'web' && only !== 'api') {
    throw new Error('--only aceita web ou api')
  }
  const releaseVersion = values['release-version']
  return {
    mode,
    ...(only === undefined ? {} : { only }),
    ...(releaseVersion === undefined ? {} : { releaseVersion }),
  }
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`sourcemaps: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof UsageError) {
      console.error(
        'uso: node scripts/sourcemaps.ts inject [--only web|api] | upload --release-version <X.Y.Z|sha7> [--only web|api]',
      )
    }
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
