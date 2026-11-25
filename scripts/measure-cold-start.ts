/**
 * Mede o CPU de um cold start da Function da API, como a Vercel o cobra em "Fluid Active CPU": um
 * processo Node novo que importa o handler (`server.mjs`), monta o app e atende um `GET /healthz`.
 * Cada execução é um processo filho isolado (nada de cache de módulo entre uma e outra), e o
 * resultado é a mediana das execuções.
 *
 * O filho reproduz o launcher `Nodejs` da Vercel (o mesmo protocolo de
 * `apps/api/test/integration/server.test.ts`): troca `http.Server.prototype.listen` por um
 * interceptador, faz `import()` do handler, chama o `listen` real numa porta efêmera e manda o
 * `GET /healthz` pelo `node:http`. Mede `process.cpuUsage()` (usuário + sistema) desde o começo do
 * script do filho até a resposta chegar:
 *
 * - `importCpuMs`: até o `import()` do handler terminar e o servidor ser capturado (env, OTel,
 *   container, app e `ready`, que o `server.ts` aguarda no topo do módulo);
 * - `coldStartCpuMs`: o anterior mais o `listen` e a requisição;
 * - `processCpuMs`: o CPU do processo inteiro, com o bootstrap do próprio Node.
 *
 * O ambiente é o da produção (`infra/vercel/env.production.json`): os valores `config` de lá e, no
 * lugar de cada `sensitive`, um valor de mentira no formato que o `apps/api/src/config/env.ts`
 * valida (`FAKE_SENSITIVE`). Todos os hosts são `.invalid` (RFC 6761): nada sai para a rede, e o
 * pool do Postgres só conecta na primeira consulta, que o `/healthz` nunca faz. O filho confere a
 * resposta (200, `status: ok`, `env: production`); sem isso a medição falha.
 *
 * Uso, depois de montar a Function como o deploy:
 *
 *   pnpm --filter @teko/web build
 *   pnpm --filter @teko/api build
 *   pnpm --filter @teko/api --prod deploy --ignore-scripts --config.node-linker=hoisted dist/vercel/api-prod
 *   node scripts/build-vercel-output.ts
 *   node scripts/measure-cold-start.ts [--runs 7] [--cpu-prof]
 *
 * Com `--cpu-prof`, cada filho grava um perfil do V8 (`.cpuprofile`, abre no DevTools) em
 * `dist/cold-start-profile/`. Nenhum caminho vem da linha de comando (ver
 * `scripts/lib/cli-guards.ts`). Saída: um JSON por linha no stdout; 0 ok, 1 falha de medição, 2
 * uso errado. Os números dependem da máquina: compare só medições feitas na mesma.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FUNCTION_NAME, HANDLER } from './build-vercel-output.ts'
import { resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Execuções padrão (ímpar, para a mediana ser uma delas). */
export const DEFAULT_RUNS = 7
const MAX_RUNS = 51
/** Teto de cada filho: um cold start passa de 10 s só com a máquina travada. */
const CHILD_TIMEOUT_MS = 60_000
/** Prefixo da linha do resultado no stdout do filho (o resto do stdout é o log do pino). */
export const RESULT_MARKER = 'COLD_START_RESULT '

/**
 * Valores de mentira das env vars Sensitive da produção, no formato que o `env.ts` aceita. Os hosts
 * são `.invalid`; o teste do script confere que cobrem todo o `sensitive` do JSON.
 */
export const FAKE_SENSITIVE: Readonly<Record<string, string>> = {
  DATABASE_URL: 'postgresql://teko_app:fake@db.invalid:5432/teko',
  GEMINI_API_KEY: 'fake-gemini-key-cold-start',
  GROQ_API_KEY: 'fake-groq-key-cold-start',
  CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  CF_AI_TOKEN: 'fake-workers-ai-token-cold-start',
  BETTER_AUTH_SECRET: 'fake-better-auth-secret-cold-start-0000',
  GITHUB_CLIENT_ID: 'fake-github-client',
  GITHUB_CLIENT_SECRET: 'fake-github-secret',
  GOOGLE_CLIENT_ID: 'fake-google-client',
  GOOGLE_CLIENT_SECRET: 'fake-google-secret',
  LANGFUSE_PUBLIC_KEY: 'pk-lf-fake-cold-start',
  LANGFUSE_SECRET_KEY: 'sk-lf-fake-cold-start',
  POSTHOG_PROJECT_KEY: 'phc_fakeColdStartMeasure0000',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.invalid/otlp',
  OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20ZmFrZTpmYWtl',
}

/** O que o runtime da Vercel e o artefato põem no ambiente, além das env vars do projeto. */
export const RUNTIME_ENV: Readonly<Record<string, string>> = {
  VERCEL: '1',
  VERCEL_REGION: 'gru1',
  VERCEL_ENV: 'production',
  GIT_SHA: '0000000000000000000000000000000000000000',
  APP_VERSION: '0.0.0-cold-start',
  // A origem do Langfuse da produção é real; aqui também vai para `.invalid`.
  LANGFUSE_BASE_URL: 'https://langfuse.invalid',
}

interface EnvFile {
  readonly config: Readonly<Record<string, { readonly value: string }>>
  readonly sensitive: Readonly<Record<string, unknown>>
}

export class MeasureError extends Error {}
class UsageError extends Error {}

/**
 * Ambiente do filho: só o necessário para o Node rodar (sem herdar o `process.env` de quem chama,
 * para nenhuma variável local mudar o boot), mais o da produção com os Sensitive de mentira.
 */
export function coldStartEnv(
  envFile: EnvFile,
  base: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const missing = Object.keys(envFile.sensitive).filter((name) => !(name in FAKE_SENSITIVE))
  if (missing.length > 0) {
    throw new MeasureError(`sem valor de mentira para ${missing.join(', ')} (FAKE_SENSITIVE)`)
  }
  const inherited = Object.fromEntries(
    ['PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].flatMap((name) => {
      const value = base[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
  const config = Object.fromEntries(
    Object.entries(envFile.config).map(([name, entry]) => [name, entry.value]),
  )
  return { ...inherited, ...config, ...FAKE_SENSITIVE, ...RUNTIME_ENV }
}

/**
 * Script do filho (ESM, `--input-type=module`). Recebe a URL do handler no argumento e imprime uma
 * linha `RESULT_MARKER` + JSON.
 */
export const PROBE_SOURCE = `
import { request, Server } from 'node:http'
const cpu0 = process.cpuUsage()
const ms = (usage) => (usage.user + usage.system) / 1000
const originalListen = Server.prototype.listen
let captured
Server.prototype.listen = function () {
  captured = this
  Server.prototype.listen = originalListen
  return this
}
await import(process.argv[1])
for (let waited = 0; captured === undefined && waited < 1000; waited += 10) {
  await new Promise((done) => setTimeout(done, 10))
}
Server.prototype.listen = originalListen
if (captured === undefined) throw new Error('o handler não chamou listen em até 1 s')
const importCpuMs = ms(process.cpuUsage(cpu0))
await new Promise((done) => captured.listen(0, '127.0.0.1', done))
const { port } = captured.address()
const response = await new Promise((done, fail) => {
  request({ host: '127.0.0.1', port, path: '/healthz', headers: { 'x-vercel-id': 'gru1::cold-start' } }, (res) => {
    let body = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => { body += chunk })
    res.on('end', () => done({ status: res.statusCode, body }))
  }).on('error', fail).end()
})
const coldStartCpuMs = ms(process.cpuUsage(cpu0))
const processCpuMs = ms(process.cpuUsage())
process.stdout.write('\\n${RESULT_MARKER}' + JSON.stringify({ importCpuMs, coldStartCpuMs, processCpuMs, ...response }) + '\\n')
process.exit(0)
`

export interface RunResult {
  readonly importCpuMs: number
  readonly coldStartCpuMs: number
  readonly processCpuMs: number
}

/** Lê e confere a linha do resultado no stdout do filho. */
export function parseProbeOutput(stdout: string): RunResult {
  const line = stdout.split(/\r?\n/).find((item) => item.startsWith(RESULT_MARKER))
  if (line === undefined) {
    throw new MeasureError('o filho terminou sem a linha do resultado')
  }
  const result = JSON.parse(line.slice(RESULT_MARKER.length)) as Record<string, unknown>
  if (result['status'] !== 200) {
    throw new MeasureError(`/healthz respondeu ${String(result['status'])}`)
  }
  const body = JSON.parse(String(result['body'])) as Record<string, unknown>
  if (body['status'] !== 'ok' || body['env'] !== 'production') {
    throw new MeasureError(`/healthz sem status ok em produção: ${String(result['body'])}`)
  }
  const numbers = ['importCpuMs', 'coldStartCpuMs', 'processCpuMs'].map((key) => result[key])
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    throw new MeasureError('resultado sem os tempos de CPU')
  }
  const [importCpuMs, coldStartCpuMs, processCpuMs] = numbers as [number, number, number]
  return { importCpuMs, coldStartCpuMs, processCpuMs }
}

/** Mediana (média dos dois do meio com quantidade par). */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new MeasureError('mediana de nada')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return Math.round(value)
}

export interface Summary {
  readonly runs: number
  readonly importCpuMs: number
  readonly coldStartCpuMs: number
  readonly processCpuMs: number
  readonly minColdStartCpuMs: number
  readonly maxColdStartCpuMs: number
}

export function summarize(results: readonly RunResult[]): Summary {
  const cold = results.map((result) => result.coldStartCpuMs)
  return {
    runs: results.length,
    importCpuMs: median(results.map((result) => result.importCpuMs)),
    coldStartCpuMs: median(cold),
    processCpuMs: median(results.map((result) => result.processCpuMs)),
    minColdStartCpuMs: Math.round(Math.min(...cold)),
    maxColdStartCpuMs: Math.round(Math.max(...cold)),
  }
}

export interface Options {
  readonly runs: number
  readonly cpuProf: boolean
}

export function parseOptions(args: readonly string[]): Options {
  let values: { runs?: string; 'cpu-prof'?: boolean }
  try {
    ;({ values } = parseArgs({
      args: [...args],
      options: { runs: { type: 'string' }, 'cpu-prof': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    }))
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const runs = values.runs === undefined ? DEFAULT_RUNS : Number(values.runs)
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new UsageError(`--runs precisa ser um inteiro de 1 a ${String(MAX_RUNS)}`)
  }
  return { runs, cpuProf: values['cpu-prof'] === true }
}

function runOnce(
  functionDir: string,
  env: Record<string, string>,
  profileDir: string | null,
): RunResult {
  const handler = pathToFileURL(join(functionDir, HANDLER)).href
  const profile = profileDir === null ? [] : ['--cpu-prof', `--cpu-prof-dir=${profileDir}`]
  // `--enable-source-maps` como o `shouldAddSourcemapSupport` do `.vc-config.json`.
  const child = spawnSync(
    process.execPath,
    [...profile, '--enable-source-maps', '--input-type=module', '-e', PROBE_SOURCE, handler],
    { cwd: functionDir, env, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, windowsHide: true },
  )
  if (child.error !== undefined) {
    throw new MeasureError(`o filho não rodou: ${child.error.message}`)
  }
  if (child.status !== 0) {
    throw new MeasureError(
      `o filho terminou com ${String(child.status)}: ${child.stderr.trim() || '(sem stderr)'}`,
    )
  }
  return parseProbeOutput(child.stdout)
}

function main(): void {
  const options = parseOptions(process.argv.slice(2))
  const inside = (...segments: string[]) =>
    resolveInsideRoot(REPO_ROOT, join(REPO_ROOT, ...segments), REPO_ROOT)
  const functionDir = inside('.vercel', 'output', 'functions', `${FUNCTION_NAME}.func`)
  if (!existsSync(join(functionDir, HANDLER))) {
    throw new MeasureError(
      `${functionDir} sem ${HANDLER}; monte a Function antes (ver o cabeçalho do script)`,
    )
  }
  const envFile = JSON.parse(
    readFileSync(inside('infra', 'vercel', 'env.production.json'), 'utf8'),
  ) as EnvFile
  const env = coldStartEnv(envFile)
  let profileDir: string | null = null
  if (options.cpuProf) {
    profileDir = inside('dist', 'cold-start-profile')
    rmSync(profileDir, { recursive: true, force: true })
    mkdirSync(profileDir, { recursive: true })
  }
  const results: RunResult[] = []
  for (let run = 1; run <= options.runs; run += 1) {
    const result = runOnce(functionDir, env, profileDir)
    results.push(result)
    console.log(JSON.stringify({ run, ...result }))
  }
  console.log(
    JSON.stringify({ summary: summarize(results), ...(profileDir ? { profileDir } : {}) }),
  )
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`measure-cold-start: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof UsageError) {
      console.error('uso: node scripts/measure-cold-start.ts [--runs N] [--cpu-prof]')
    }
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
