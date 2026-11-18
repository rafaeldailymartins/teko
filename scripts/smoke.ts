/**
 * Smoke do deploy (F7, mudança OpenSpec `add-smoke-tests`; `docs/architecture/ci-cd-e-ambientes.md`,
 * "Smoke"): cerca de 15 requests HTTP contra um ambiente real, sem LLM, sem sessão e sem escrever
 * nada no banco. Dois modos:
 *
 * - `deployment`: a URL única da deployment (`https://<projeto>-<hash>-<time>.vercel.app`), antes
 *   do `vercel promote`. A URL única tem Deployment Protection (Standard), então cada request leva o
 *   header `x-vercel-protection-bypass` com o segredo de `VERCEL_AUTOMATION_BYPASS_SECRET` (env, nunca
 *   argumento nem saída). Uma checagem a mais confere que a mesma URL, sem o bypass, não chega à API.
 *   O WAF e o domínio antigo ficam para o modo canônico (o domínio antigo só aponta para a
 *   deployment promovida).
 * - `canonical`: o domínio público do ambiente (`WEB_ORIGIN` de `infra/vercel/env.<env>.json`),
 *   depois do promote, sem bypass. Soma o WAF (`GET /api/qualquer-coisa` → 403) e o domínio antigo
 *   (`teko-api*.vercel.app` → 308 para o canônico). Logo depois do promote, a Vercel ainda pode
 *   servir a deployment anterior por um instante (spike F1 (b)): só o `/healthz` repete, e só
 *   enquanto o `gitSha` for outro, até {@link SHA_RETRY.attempts} vezes.
 *
 * Contrato fixo (o `deploy.yml` e o `smoke.yml` chamam assim):
 *
 *   node scripts/smoke.ts --env staging|production --mode deployment|canonical \
 *     --base-url <url> --expected-sha <40 hex> [--out <arquivo.json>]
 *
 * Sai com 0 se todas as checagens passaram, 1 se alguma falhou e 2 em argumento inválido. A
 * `--base-url` não é livre: no modo `canonical` ela precisa ser o `WEB_ORIGIN` do ambiente; no
 * `deployment`, uma URL única `https://` em `vercel.app` do projeto do ambiente (o bypass nunca vai
 * para outro host). `--out` grava o relatório JSON (cada checagem com status, tentativas e tempo,
 * útil para medir cold start) e só aceita caminho dentro do repositório (`scripts/lib/cli-guards.ts`).
 * Com `GITHUB_STEP_SUMMARY`, uma tabela vai para o resumo do job.
 *
 * Sem dependências: só o Node 24 (type stripping) e as constantes do site estático e das rotas da
 * Vercel (`scripts/lib/static-site-policy.ts` e `scripts/build-vercel-output.ts`),
 * as mesmas que geram o `config.json`. Testes em `scripts/smoke.test.ts`, com servidor HTTP local.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { LEGACY_HOST_REDIRECTS } from './build-vercel-output.ts'
import { CliGuardError, resolveInsideRoot } from './lib/cli-guards.ts'
import { ROOT_REDIRECT_HEADERS, STATIC_HEADERS } from './lib/static-site-policy.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

export const ENVIRONMENTS = ['staging', 'production'] as const
export type SmokeEnv = (typeof ENVIRONMENTS)[number]

export const MODES = ['deployment', 'canonical'] as const
export type SmokeMode = (typeof MODES)[number]

/** Projeto Vercel de cada ambiente (prefixo das URLs únicas). */
export const PROJECTS: Readonly<Record<SmokeEnv, string>> = {
  production: 'tekoia',
  staging: 'tekoia-staging',
}

/** Header do Protection Bypass for Automation da Vercel. */
export const BYPASS_HEADER = 'x-vercel-protection-bypass'
export const BYPASS_ENV = 'VERCEL_AUTOMATION_BYPASS_SECRET'

/** Repetição do `/healthz` no modo canônico, só enquanto o domínio serve outro `gitSha`. */
export const SHA_RETRY = { attempts: 6, delayMs: 5_000 } as const

/** Prazo de cada request: cold start da Function + resume do Neon ficam abaixo de 10 s (DoD F7). */
export const REQUEST_TIMEOUT_MS = 20_000

/** Id de pergunta bem formado e inexistente: o stream sem sessão para no 401, antes do banco. */
export const PROBE_QUESTION_ID = '00000000-0000-4000-8000-000000000000'

/** Origem de outro site, para a checagem do `Origin` errado. */
export const FOREIGN_ORIGIN = 'https://evil.example'

const SHA = /^[0-9a-f]{40}$/

export class UsageError extends Error {}

export interface SmokeTargets {
  readonly env: SmokeEnv
  readonly mode: SmokeMode
  /** Base dos requests (URL única ou domínio canônico), sem barra final. */
  readonly baseUrl: string
  /** `WEB_ORIGIN` do ambiente: o `Origin` aceito pela API e o destino do 308. */
  readonly canonicalOrigin: string
  /** Domínio antigo do projeto (`teko-api*.vercel.app`), só usado no modo canônico. */
  readonly legacyOrigin: string
  readonly expectedSha: string
}

export interface SmokeDeps {
  readonly fetch: typeof fetch
  /** Segredo do bypass (só no modo `deployment`). */
  readonly bypass?: string | undefined
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  readonly log?: (line: string) => void
  readonly shaRetry?: { readonly attempts: number; readonly delayMs: number }
}

export interface CheckResult {
  readonly name: string
  readonly ok: boolean
  readonly method: string
  readonly url: string
  readonly status: number | null
  readonly attempts: number
  /** Tempo da última tentativa, em ms (a primeira do `/healthz` mede o cold start). */
  readonly durationMs: number
  readonly detail: string
}

export interface SmokeReport {
  readonly env: SmokeEnv
  readonly mode: SmokeMode
  readonly baseUrl: string
  readonly expectedSha: string
  readonly ok: boolean
  readonly startedAt: string
  readonly durationMs: number
  readonly checks: readonly CheckResult[]
}

interface Probe {
  readonly status: number
  readonly headers: Headers
  readonly body: string
  readonly durationMs: number
}

interface RequestSpec {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  /** Manda o header de bypass (só no modo `deployment`, e só para a URL única). */
  readonly bypass?: boolean
}

/** Uma checagem: monta o request e julga a resposta (`null` = passou; texto = o motivo da falha). */
interface CheckSpec {
  readonly name: string
  readonly url: string
  readonly request: RequestSpec
  readonly verify: (probe: Probe) => string | null
  /** Repete enquanto `retryIf` devolver `true` (só o `gitSha` do canônico). */
  readonly retryIf?: (probe: Probe) => boolean
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Todos os problemas de uma resposta, juntos; vazio = passou. */
function problems(...items: (string | false | null | undefined)[]): string | null {
  const found = items.filter((item): item is string => typeof item === 'string')
  return found.length === 0 ? null : found.join('; ')
}

function expectStatus(probe: Probe, status: number): string | null {
  return probe.status === status ? null : `status ${probe.status}, esperado ${status}`
}

function header(probe: Probe, name: string): string {
  return probe.headers.get(name) ?? ''
}

/** A CDN não pode ter servido do cache uma resposta da API. */
function notCdnCached(probe: Probe): string | null {
  const cache = header(probe, 'x-vercel-cache').toUpperCase()
  return cache === 'HIT' || cache === 'STALE' ? `x-vercel-cache: ${cache}` : null
}

function noStore(probe: Probe): string | null {
  return /\bno-store\b/.test(header(probe, 'cache-control'))
    ? null
    : `cache-control sem no-store (${header(probe, 'cache-control') || 'ausente'})`
}

function healthOf(probe: Probe): Record<string, unknown> {
  const body = parseJson(probe.body)
  return isRecord(body) ? body : {}
}

function verifyHealth(targets: SmokeTargets) {
  return (probe: Probe): string | null => {
    const health = healthOf(probe)
    return problems(
      expectStatus(probe, 200),
      health['status'] !== 'ok' && `status do processo ${JSON.stringify(health['status'])}`,
      health['env'] !== targets.env &&
        `env ${JSON.stringify(health['env'])}, esperado ${targets.env}`,
      health['gitSha'] !== targets.expectedSha &&
        `gitSha ${JSON.stringify(health['gitSha'])}, esperado ${targets.expectedSha}`,
    )
  }
}

function verifyRootRedirect(location: string) {
  return (probe: Probe): string | null =>
    problems(
      expectStatus(probe, 302),
      header(probe, 'location') !== location &&
        `location ${JSON.stringify(header(probe, 'location'))}, esperado ${location}`,
      header(probe, 'cache-control') !== ROOT_REDIRECT_HEADERS['Cache-Control'] &&
        `cache-control ${JSON.stringify(header(probe, 'cache-control'))}`,
      !/accept-language/i.test(header(probe, 'vary')) && 'vary sem Accept-Language',
    )
}

/** Headers de segurança do estático e a CSP do documento (a do export, com hashes). */
function verifyPage(locale: string) {
  return (probe: Probe): string | null => {
    const csp = header(probe, 'content-security-policy')
    const missing = Object.entries(STATIC_HEADERS)
      .filter(([name, value]) => header(probe, name) !== value)
      .map(([name]) => name)
    return problems(
      expectStatus(probe, 200),
      !header(probe, 'content-type').startsWith('text/html') &&
        `content-type ${JSON.stringify(header(probe, 'content-type'))}`,
      missing.length > 0 && `headers de segurança ausentes ou diferentes: ${missing.join(', ')}`,
      !csp.startsWith("default-src 'self'") && 'CSP ausente ou sem default-src self',
      !csp.includes("frame-ancestors 'none'") && "CSP sem frame-ancestors 'none'",
      /script-src[^;]*'unsafe-inline'/.test(csp) && "CSP com 'unsafe-inline' em script-src",
      !probe.body.includes(`lang="${locale}"`) && `HTML sem lang="${locale}"`,
    )
  }
}

function verifyCoverage(probe: Probe): string | null {
  const body = parseJson(probe.body)
  const valid =
    isRecord(body) &&
    Number.isInteger(body['corpusVersion']) &&
    Array.isArray(body['families']) &&
    body['families'].length > 0
  return problems(
    expectStatus(probe, 200),
    !valid && 'corpo sem corpusVersion inteiro e famílias',
    noStore(probe),
    notCdnCached(probe),
  )
}

function verifyProblem(status: number, code: string) {
  return (probe: Probe): string | null => {
    const body = parseJson(probe.body)
    return problems(
      expectStatus(probe, status),
      (!isRecord(body) || body['code'] !== code) && `problem+json sem code ${code}`,
      noStore(probe),
    )
  }
}

function verifyLegacyRedirect(targets: SmokeTargets, path: string) {
  const location = `${targets.canonicalOrigin}${path}`
  return (probe: Probe): string | null =>
    problems(
      expectStatus(probe, 308),
      header(probe, 'location') !== location &&
        `location ${JSON.stringify(header(probe, 'location'))}, esperado ${location}`,
    )
}

/**
 * Sem o bypass, a URL única fica atrás da Deployment Protection: a Vercel responde 401 ou manda
 * para o login (3xx para outro host). Qualquer 2xx, ou um corpo do `/healthz`, quer dizer que a
 * API respondeu sem proteção.
 */
function verifyProtected(targets: SmokeTargets) {
  return (probe: Probe): string | null => {
    const health = healthOf(probe)
    const location = header(probe, 'location')
    const redirectsAway =
      probe.status >= 300 &&
      probe.status < 400 &&
      location !== '' &&
      new URL(location, targets.baseUrl).host !== new URL(targets.baseUrl).host
    const blocked = probe.status === 401 || probe.status === 403 || redirectsAway
    return problems(
      !blocked && `status ${probe.status} sem bypass: a URL única não está protegida`,
      'gitSha' in health && 'o /healthz respondeu sem bypass',
    )
  }
}

const JSON_POST = { 'content-type': 'application/json' } as const

/** As checagens do modo, na ordem: o `/healthz` primeiro (cold start e o sha certo). */
export function plan(targets: SmokeTargets): CheckSpec[] {
  const base = targets.baseUrl
  const bypass = targets.mode === 'deployment'
  const streamUrl = `${base}/api/v1/questions/${PROBE_QUESTION_ID}/stream`
  const checks: CheckSpec[] = [
    {
      name: 'healthz',
      url: `${base}/healthz`,
      request: { bypass },
      verify: verifyHealth(targets),
      ...(targets.mode === 'canonical'
        ? {
            retryIf: (probe: Probe) =>
              probe.status === 200 && healthOf(probe)['gitSha'] !== targets.expectedSha,
          }
        : {}),
    },
    {
      name: 'api-healthz',
      url: `${base}/api/healthz`,
      request: { bypass },
      verify: (probe) => problems(verifyHealth(targets)(probe), noStore(probe)),
    },
    {
      name: 'root-redirect-en',
      url: `${base}/`,
      request: { bypass, headers: { 'accept-language': 'en-US,en;q=0.9' } },
      verify: verifyRootRedirect('/en/'),
    },
    {
      name: 'root-redirect-pt-BR',
      url: `${base}/`,
      request: { bypass, headers: { 'accept-language': 'pt-BR,pt;q=0.9' } },
      verify: verifyRootRedirect('/pt-BR/'),
    },
    { name: 'page-pt-BR', url: `${base}/pt-BR/`, request: { bypass }, verify: verifyPage('pt-BR') },
    { name: 'page-en', url: `${base}/en/`, request: { bypass }, verify: verifyPage('en') },
    // Duas leituras: a primeira de uma instância lê o Neon; nenhuma pode vir do cache da CDN.
    {
      name: 'coverage',
      url: `${base}/api/v1/coverage`,
      request: { bypass },
      verify: verifyCoverage,
    },
    {
      name: 'coverage-again',
      url: `${base}/api/v1/coverage`,
      request: { bypass },
      verify: verifyCoverage,
    },
    {
      name: 'stream-without-session',
      url: streamUrl,
      request: {
        bypass,
        method: 'POST',
        headers: { ...JSON_POST, origin: targets.canonicalOrigin },
        body: '{}',
      },
      verify: verifyProblem(401, 'unauthenticated'),
    },
    {
      name: 'stream-foreign-origin',
      url: streamUrl,
      request: {
        bypass,
        method: 'POST',
        headers: { ...JSON_POST, origin: FOREIGN_ORIGIN },
        body: '{}',
      },
      verify: verifyProblem(403, 'forbidden'),
    },
  ]
  if (targets.mode === 'deployment') {
    checks.push({
      name: 'deployment-protection',
      url: `${base}/healthz`,
      request: { bypass: false },
      verify: verifyProtected(targets),
    })
    return checks
  }
  checks.push(
    {
      // Regra 1 do WAF (`infra/vercel/firewall-rules.json`): sem ela, a API responderia 404.
      name: 'waf-unknown-api',
      url: `${base}/api/qualquer-coisa`,
      request: {},
      verify: (probe) => expectStatus(probe, 403),
    },
    {
      name: 'legacy-domain',
      url: `${targets.legacyOrigin}/pt-BR/`,
      request: {},
      verify: verifyLegacyRedirect(targets, '/pt-BR/'),
    },
    {
      name: 'legacy-domain-api',
      url: `${targets.legacyOrigin}/healthz`,
      request: {},
      verify: verifyLegacyRedirect(targets, '/healthz'),
    },
  )
  return checks
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

async function probe(spec: CheckSpec, deps: SmokeDeps, now: () => number): Promise<Probe> {
  const headers: Record<string, string> = { 'user-agent': 'teko-smoke', ...spec.request.headers }
  if (spec.request.bypass === true) {
    if (deps.bypass === undefined || deps.bypass === '') {
      throw new Error(`${BYPASS_ENV} ausente`)
    }
    headers[BYPASS_HEADER] = deps.bypass
  }
  const started = now()
  const response = await deps.fetch(spec.url, {
    method: spec.request.method ?? 'GET',
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(spec.request.body === undefined ? {} : { body: spec.request.body }),
  })
  const body = await response.text()
  return { status: response.status, headers: response.headers, body, durationMs: now() - started }
}

/** Tira o segredo de qualquer texto que vá para log ou relatório (defesa em profundidade). */
function redact(text: string, secret: string | undefined): string {
  return secret === undefined || secret === '' ? text : text.replaceAll(secret, '***')
}

async function runCheck(spec: CheckSpec, deps: SmokeDeps): Promise<CheckResult> {
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? defaultSleep
  const retry = deps.shaRetry ?? SHA_RETRY
  const maxAttempts = spec.retryIf === undefined ? 1 : retry.attempts
  const method = spec.request.method ?? 'GET'
  let attempts = 0
  for (;;) {
    attempts += 1
    const started = now()
    let result: Probe
    try {
      result = await probe(spec, deps, now)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        name: spec.name,
        ok: false,
        method,
        url: spec.url,
        status: null,
        attempts,
        durationMs: now() - started,
        detail: redact(`request falhou: ${message}`, deps.bypass),
      }
    }
    if (spec.retryIf?.(result) === true && attempts < maxAttempts) {
      deps.log?.(`  ${spec.name}: ainda a deployment anterior (tentativa ${attempts}); de novo`)
      await sleep(retry.delayMs)
      continue
    }
    const failure = spec.verify(result)
    return {
      name: spec.name,
      ok: failure === null,
      method,
      url: spec.url,
      status: result.status,
      attempts,
      durationMs: result.durationMs,
      detail: redact(failure ?? 'ok', deps.bypass),
    }
  }
}

/** Roda as checagens em sequência (sem paralelismo: o rate limit do stream conta por IP). */
export async function runSmoke(targets: SmokeTargets, deps: SmokeDeps): Promise<SmokeReport> {
  const now = deps.now ?? Date.now
  const started = now()
  const checks: CheckResult[] = []
  for (const spec of plan(targets)) {
    const result = await runCheck(spec, deps)
    deps.log?.(
      `${result.ok ? 'ok  ' : 'FAIL'} ${result.name} (${result.status ?? '-'}, ${result.durationMs} ms` +
        `${result.attempts > 1 ? `, ${result.attempts} tentativas` : ''})${result.ok ? '' : `: ${result.detail}`}`,
    )
    checks.push(result)
  }
  return {
    env: targets.env,
    mode: targets.mode,
    baseUrl: targets.baseUrl,
    expectedSha: targets.expectedSha,
    ok: checks.every((check) => check.ok),
    startedAt: new Date(started).toISOString(),
    durationMs: now() - started,
    checks,
  }
}

/** `WEB_ORIGIN` de `infra/vercel/env.<env>.json`. */
export function canonicalOriginOf(envFile: unknown): string {
  const origin = isRecord(envFile) && isRecord(envFile['config']) ? envFile['config'] : {}
  const entry = origin['WEB_ORIGIN']
  const value = isRecord(entry) ? entry['value'] : undefined
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9.-]+$/.test(value)) {
    throw new Error('env.<env>.json sem config.WEB_ORIGIN https válido')
  }
  return value
}

/** Domínio antigo cujo 308 leva ao canônico do ambiente (constante das rotas da Vercel). */
export function legacyOriginOf(canonicalOrigin: string): string {
  const redirect = LEGACY_HOST_REDIRECTS.find(({ to }) => to === canonicalOrigin)
  if (redirect === undefined) {
    throw new Error(`nenhum domínio antigo redireciona para ${canonicalOrigin}`)
  }
  return `https://${redirect.from}`
}

/**
 * URL única aceita para o bypass: `https://<projeto>-<sufixo>.vercel.app`, sem caminho, query nem
 * porta, que não seja o domínio canônico nem o antigo e (na produção) nem uma URL do staging.
 */
export function isDeploymentUrl(url: string, env: SmokeEnv): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    return false
  }
  const project = PROJECTS[env]
  const host = parsed.hostname
  const match = new RegExp(`^${project}-([a-z0-9-]+)\\.vercel\\.app$`).exec(host)
  if (match === null) {
    return false
  }
  return env !== 'production' || !host.startsWith(`${PROJECTS.staging}-`)
}

export interface CliOptions {
  readonly targets: SmokeTargets
  readonly out: string | undefined
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  flag: string,
): T {
  if (value === undefined || !(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`${flag} precisa ser ${allowed.join('|')}`)
  }
  return value as T
}

/** Valida a linha de comando contra o contrato e monta os alvos (lança `UsageError`). */
export function parseCli(
  argv: readonly string[],
  readEnvFile: (env: SmokeEnv) => unknown = readEnvJson,
): CliOptions {
  let values: Record<string, string | undefined>
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: {
        env: { type: 'string' },
        mode: { type: 'string' },
        'base-url': { type: 'string' },
        'expected-sha': { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }))
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const env = oneOf(values['env'], ENVIRONMENTS, '--env')
  const mode = oneOf(values['mode'], MODES, '--mode')
  const expectedSha = values['expected-sha'] ?? ''
  if (!SHA.test(expectedSha)) {
    throw new UsageError(
      '--expected-sha precisa ser um SHA de 40 caracteres hexadecimais minúsculos',
    )
  }
  const canonicalOrigin = canonicalOriginOf(readEnvFile(env))
  const rawBase = values['base-url'] ?? ''
  const baseUrl = rawBase.replace(/\/$/, '')
  if (mode === 'canonical' && baseUrl !== canonicalOrigin) {
    throw new UsageError(`--base-url no modo canonical precisa ser ${canonicalOrigin}`)
  }
  if (mode === 'deployment' && !isDeploymentUrl(rawBase, env)) {
    throw new UsageError(
      `--base-url no modo deployment precisa ser a URL única https://${PROJECTS[env]}-<...>.vercel.app`,
    )
  }
  const out = values['out']
  if (out !== undefined && !out.endsWith('.json')) {
    throw new UsageError('--out precisa terminar em .json')
  }
  return {
    targets: {
      env,
      mode,
      baseUrl,
      canonicalOrigin,
      legacyOrigin: legacyOriginOf(canonicalOrigin),
      expectedSha,
    },
    out,
  }
}

/** Os dois arquivos possíveis, fixos: nenhum valor da linha de comando vira caminho. */
const ENV_FILES: Readonly<Record<SmokeEnv, string>> = {
  staging: join(REPO_ROOT, 'infra', 'vercel', 'env.staging.json'),
  production: join(REPO_ROOT, 'infra', 'vercel', 'env.production.json'),
}

function readEnvJson(env: SmokeEnv): unknown {
  return JSON.parse(readFileSync(ENV_FILES[env], 'utf8')) as unknown
}

/** Tabela em markdown para o `GITHUB_STEP_SUMMARY`. */
export function summaryMarkdown(report: SmokeReport): string {
  const rows = report.checks.map(
    (check) =>
      `| ${check.ok ? 'ok' : 'FALHA'} | \`${check.name}\` | ${check.status ?? '-'} | ${check.attempts} | ${check.durationMs} | ${check.detail.replaceAll('|', '\\|')} |`,
  )
  return [
    `### Smoke ${report.env} (${report.mode}): ${report.ok ? 'verde' : 'vermelho'}`,
    '',
    `\`${report.baseUrl}\`, sha \`${report.expectedSha}\`, ${report.durationMs} ms no total.`,
    '',
    '| | Checagem | Status | Tentativas | ms | Detalhe |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n')
}

export interface MainDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
  readonly error: (line: string) => void
  readonly readEnvFile?: (env: SmokeEnv) => unknown
  readonly sleep?: (ms: number) => Promise<void>
  readonly shaRetry?: { readonly attempts: number; readonly delayMs: number }
  /** Resolve `--out` contra o repositório (padrão: `resolveInsideRoot` a partir do cwd). */
  readonly resolveOut?: (out: string) => string
}

/** Código de saída: 0 verde, 1 vermelho, 2 uso inválido. */
export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
  let options: CliOptions
  let outFile: string | undefined
  const bypass = deps.env[BYPASS_ENV]
  try {
    options = parseCli(argv, deps.readEnvFile)
    if (options.targets.mode === 'deployment' && (bypass === undefined || bypass === '')) {
      throw new UsageError(`${BYPASS_ENV} ausente no ambiente (modo deployment)`)
    }
    outFile =
      options.out === undefined
        ? undefined
        : (deps.resolveOut ?? ((out) => resolveInsideRoot(REPO_ROOT, out)))(options.out)
  } catch (error) {
    if (error instanceof UsageError || error instanceof CliGuardError) {
      deps.error(`smoke: ${redact(error.message, bypass)}`)
      deps.error(
        'uso: node scripts/smoke.ts --env staging|production --mode deployment|canonical --base-url <url> --expected-sha <40 hex> [--out <arquivo.json>]',
      )
      return 2
    }
    // Configuração do repositório quebrada (`env.<env>.json`, rotas antigas): falha, não uso.
    deps.error(`smoke: ${redact(error instanceof Error ? error.message : String(error), bypass)}`)
    return 1
  }
  const { targets } = options
  deps.log(
    `smoke ${targets.env} (${targets.mode}) em ${targets.baseUrl}, sha ${targets.expectedSha}`,
  )
  const report = await runSmoke(targets, {
    fetch: deps.fetch,
    bypass: targets.mode === 'deployment' ? bypass : undefined,
    log: deps.log,
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    ...(deps.shaRetry === undefined ? {} : { shaRetry: deps.shaRetry }),
  })
  const failed = report.checks.filter((check) => !check.ok).length
  deps.log(
    report.ok
      ? `smoke verde: ${report.checks.length} checagens em ${report.durationMs} ms`
      : `smoke vermelho: ${failed} de ${report.checks.length} checagens falharam`,
  )
  const json = redact(`${JSON.stringify(report, null, 2)}\n`, bypass)
  if (outFile !== undefined) {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, json)
  }
  const summary = deps.env['GITHUB_STEP_SUMMARY']
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, redact(summaryMarkdown(report), bypass))
  }
  return report.ok ? 0 : 1
}

/**
 * Uma linha por chamada: uma quebra de linha vinda de um header ou corpo da resposta não forja
 * comando do Actions (`::...`) nem uma linha falsa do relatório.
 */
export function singleLine(line: string): string {
  return line.replaceAll(/[\r\n]/gu, ' ')
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    env: process.env,
    fetch: globalThis.fetch,
    log: (line) => console.log(singleLine(line)),
    error: (line) => console.error(singleLine(line)),
  })
}
