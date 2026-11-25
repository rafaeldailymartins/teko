/**
 * Job `vercel-usage` do `.github/workflows/ops.yml` (F7, mudanças OpenSpec `add-usage-guard` e
 * `fix-vercel-usage-hobby`): guarda de uso da conta Vercel Hobby
 * (`docs/architecture/contas-e-cotas.md`, "Guard rails").
 *
 * 1. **Fonte.** No Hobby não há relatório de uso por API: o `vercel billing usage` e o
 *    `GET /v1/billing/charges` respondem 404 `costs_not_found` (a conta não tem assinatura), e o
 *    `vercel metrics` só aceita consultas de invocação de função que comecem há no máximo 30 minutos
 *    (Observability Plus, que o Hobby não compra, para o resto). O job roda a cada 10 minutos e lê,
 *    com o Vercel CLI isolado de `tools/vercel-cli`, a janela que ainda não contou (no máximo os
 *    últimos 27 minutos, menos 5 de atraso da ingestão) de quatro métricas da conta inteira
 *    (`--all`): CPU ativa, memória provisionada (limite superior: GB-h de duração das invocações),
 *    invocações e Fast Origin Transfer das funções. Fast Data Transfer, CDN Requests, spans e
 *    imagens não têm fonte no Hobby e ficam fora da guarda (o e-mail de uso da Vercel é o único
 *    aviso deles).
 * 2. **Estado.** As janelas somam por dia (UTC) em `.vercel-usage/state.json`, que o workflow
 *    guarda no cache do Actions entre execuções. O uso de 30 dias é a soma dos últimos 30 dias,
 *    extrapolada pela cobertura: minutos acompanhados sobre minutos efetivamente lidos (cron
 *    atrasado ou execução que falhou viram lacuna, e a lacuna é preenchida pela média do que foi
 *    lido). A razão estimativa/cota de cada recurso medido sai como
 *    `teko_vercel_usage_ratio{resource}` por OTLP (`scripts/lib/otlp-metrics.ts`), junto com o
 *    sucesso do job.
 * 3. **85%** em qualquer recurso medido: kill switch de geração. Grava `LLM_KILL_SWITCH=true`
 *    (Production) nos dois projetos e redeploya a deployment de produção atual de cada um (env var
 *    só vale em deployment nova). **95%**: além disso, `scripts/vercel-firewall.ts --lockdown on`
 *    nos dois projetos (a regra 1 do WAF passa a negar tudo exceto `/healthz` e a página de aviso).
 * 4. Nunca desliga nada sozinho: a volta é manual (`--release`, runbook `budget-kill-switch.md`).
 *    Idempotente: com o kill switch já ligado e a deployment de produção mais nova que a variável,
 *    não grava nem redeploya de novo.
 *
 * Fonte que não responde (erro do CLI, `payment_required`, formato novo) deixa o job vermelho, sem
 * registrar sucesso e sem avançar o estado; o alerta `teko-ops-job-stale` dispara em 6 h.
 *
 * Modos:
 *   node scripts/vercel-usage.ts [--dry-run]
 *   node scripts/vercel-usage.ts --force-threshold 0.85|0.95 [--only staging|production] [--dry-run]
 *   node scripts/vercel-usage.ts --release [--only staging|production] [--dry-run]
 *
 * `--force-threshold` age como se o uso tivesse chegado ao limiar, sem ler o uso nem enviar
 * métricas: é o exercício do DoD da F7 no staging. `--release` desliga o kill switch (com redeploy)
 * e o lockdown. `--dry-run` só lê e mostra o plano, sem gravar o estado.
 *
 * Ambiente: `VERCEL_TOKEN` (no workflow, o segredo `VERCEL_USAGE_TOKEN` do environment `ops`),
 * `VERCEL_ORG_ID` (o time Hobby) e a credencial OTLP do `ops`. Sem `VERCEL_TOKEN`, avisa e sai com 0.
 * Os projetos, o CLI e o arquivo de estado são constantes; nenhum caminho nem executável vem da
 * linha de comando (`scripts/lib/cli-guards.ts`).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exit } from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { envValue, type GaugePoint, logLine, publishPoints } from './lib/otlp-metrics.ts'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Entrypoint do Vercel CLI instalado por `pnpm --dir tools/vercel-cli install --frozen-lockfile`. */
export const VERCEL_CLI = join(
  REPO_ROOT,
  'tools',
  'vercel-cli',
  'node_modules',
  'vercel',
  'dist',
  'vc.js',
)
/** Script do WAF (mudança add-vercel-deployment): `--env staging|production --lockdown on|off`. */
export const FIREWALL_SCRIPT = join(REPO_ROOT, 'scripts', 'vercel-firewall.ts')
/** Estado acumulado entre execuções (o `ops.yml` o guarda no cache do Actions; fora do git). */
export const STATE_FILE = join(REPO_ROOT, '.vercel-usage', 'state.json')
const VERCEL_API = 'https://api.vercel.com'
const SERVICE_NAME = 'teko-ops'
const TITLE = 'vercel-usage'
const KILL_SWITCH = 'LLM_KILL_SWITCH'
/** ID do time (`team_...`); só o formato, para nada estranho entrar na URL nem nos argumentos. */
const ORG_ID = /^[A-Za-z0-9_]{1,64}$/u
const POLL_MS = 10_000
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export const KILL_SWITCH_RATIO = 0.85
export const LOCKDOWN_RATIO = 0.95

/**
 * Quanto para trás o `vercel metrics` aceita no Hobby: 30 minutos ("Observability Plus is required
 * for function invocations that start more than 30 minutes ago"), com 3 de folga para as quatro
 * chamadas do CLI.
 */
export const LOOKBACK_MINUTES = 27
/** Atraso dado à ingestão das métricas: os últimos minutos ficam para a execução seguinte. */
export const LAG_MINUTES = 5
/** Janela que a Vercel usa para pausar a conta Hobby ("wait until 30 days have passed"). */
export const WINDOW_DAYS = 30
/** Abaixo disso, o resumo avisa que a estimativa é pouco confiável. */
export const LOW_COVERAGE = 0.5

export type Environment = 'production' | 'staging'

export interface Project {
  readonly environment: Environment
  readonly name: string
  readonly id: string
  /** Domínio canônico: a deployment para onde ele aponta é a "deployment de produção atual". */
  readonly domain: string
}

/** `infra/vercel/README.md`, "Projetos". Staging primeiro: é onde o exercício acontece. */
export const PROJECTS: readonly Project[] = [
  {
    environment: 'staging',
    name: 'tekoia-staging',
    id: 'prj_rgXwv6zcTTb1UPU1qkEMrAWu6hY5',
    domain: 'tekoia-staging.vercel.app',
  },
  {
    environment: 'production',
    name: 'tekoia',
    id: 'prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as',
    domain: 'tekoia.vercel.app',
  },
]

export interface Quota {
  /** Label `resource` da métrica. */
  readonly resource: string
  readonly limit: number
  /** Unidade do `limit` (só para o resumo). */
  readonly unit: string
}

/**
 * Cotas mensais da conta Hobby, somando os dois projetos. Fonte: https://vercel.com/docs/plans/hobby
 * ("Hobby Plan Included Usage", lida pelo Context7 `/websites/vercel` em 2026-11-18) e a tabela da
 * Vercel em `docs/architecture/contas-e-cotas.md`. Deployment storage não é uso mensal e fica na
 * checagem manual mensal.
 */
export const HOBBY_QUOTAS: readonly Quota[] = [
  { resource: 'provisioned_memory', limit: 360, unit: 'GB-h' },
  { resource: 'active_cpu', limit: 4, unit: 'h' },
  { resource: 'function_invocations', limit: 1_000_000, unit: 'invocações' },
  { resource: 'fast_origin_transfer', limit: 10, unit: 'GB' },
  { resource: 'fast_data_transfer', limit: 100, unit: 'GB' },
  { resource: 'cdn_requests', limit: 1_000_000, unit: 'requests' },
  { resource: 'tracing_spans', limit: 1_000_000, unit: 'spans' },
  { resource: 'image_transformations', limit: 5000, unit: 'transformações' },
  { resource: 'image_cache_reads', limit: 300_000, unit: 'leituras' },
  { resource: 'image_cache_writes', limit: 100_000, unit: 'escritas' },
]

export interface UsageSource {
  readonly resource: string
  /** Métrica do `vercel metrics schema` (Vercel CLI 65.11.0). */
  readonly metric: string
  readonly aggregation: 'count' | 'sum'
  /** Divisor da unidade da métrica até a unidade da cota. */
  readonly divisor: number
}

/**
 * O que o `vercel metrics` responde no Hobby (conferido em 2026-11-25 contra a conta real): só as
 * métricas de `vercel.function_invocation.*` nos últimos 30 minutos. `vercel.request.*` (CDN
 * Requests, Fast Data Transfer) responde `payment_required` em qualquer janela. A memória
 * provisionada do Fluid só é cobrada enquanto há requisição em andamento, e invocações concorrentes
 * dividem a instância: a soma dos GB-h de duração de cada invocação é um limite superior dela.
 */
export const USAGE_SOURCES: readonly UsageSource[] = [
  {
    resource: 'active_cpu',
    metric: 'vercel.function_invocation.function_cpu_time_ms',
    aggregation: 'sum',
    divisor: 3_600_000,
  },
  {
    resource: 'provisioned_memory',
    metric: 'vercel.function_invocation.function_duration_gbhr',
    aggregation: 'sum',
    divisor: 1,
  },
  {
    resource: 'function_invocations',
    metric: 'vercel.function_invocation.count',
    aggregation: 'count',
    divisor: 1,
  },
  {
    resource: 'fast_origin_transfer',
    metric: 'vercel.function_invocation.fot_total_bytes',
    aggregation: 'sum',
    divisor: 1e9,
  },
]

/** Coluna do valor no JSON do `vercel metrics` (`getRollupColumnName` do CLI 65.11.0). */
export function rollupColumn(source: UsageSource): string {
  return `${source.metric}_${source.aggregation}`.replaceAll(/[./]/gu, '_')
}

/**
 * Total da janela no JSON do `vercel metrics <métrica> --json` (CLI 65.11.0, `formatQueryJson`):
 * `{ query, summary: [{ <coluna>: número | null }], data: [{ timestamp, <coluna> }] }`, ou
 * `{ error: { code, message } }`. Sem invocação na janela, `summary` e `data` vêm vazios (0). Linha
 * de resumo sem a coluna é formato novo: falha, para não virar uso zero.
 */
export function parseMetricsOutput(raw: string, source: UsageSource): number {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`vercel metrics ${source.metric}: saída não é JSON`)
  }
  const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >
  const error = record['error']
  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    const detail = [code, message].filter((part) => typeof part === 'string').join(': ')
    throw new Error(`vercel metrics ${source.metric}: ${detail.slice(0, 300)}`)
  }
  const summary = record['summary']
  if (!Array.isArray(summary)) {
    throw new Error(`vercel metrics ${source.metric}: saída sem "summary"`)
  }
  const column = rollupColumn(source)
  let total = 0
  for (const row of summary as unknown[]) {
    const value = typeof row === 'object' && row !== null ? Reflect.get(row, column) : undefined
    if (value === null) {
      continue
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`vercel metrics ${source.metric}: resumo sem a coluna ${column}`)
    }
    total += value
  }
  return total / source.divisor
}

export interface UsageWindow {
  /** Início (inclusivo), em ms, alinhado ao minuto. */
  readonly since: number
  /** Fim (exclusivo), em ms, alinhado ao minuto. */
  readonly until: number
}

/**
 * Janela desta execução: do fim da anterior (ou do mais antigo que o Hobby aceita) até agora menos
 * o atraso da ingestão. `undefined`: menos de um minuto novo.
 */
export function planWindow(now: Date, coveredUntil?: number): UsageWindow | undefined {
  const minute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS
  const until = minute - LAG_MINUTES * MINUTE_MS
  const earliest = minute - LOOKBACK_MINUTES * MINUTE_MS
  const since = Math.max(earliest, coveredUntil ?? earliest)
  return until - since < MINUTE_MS ? undefined : { since, until }
}

export interface UsageDay {
  /** `YYYY-MM-DD` (UTC). */
  readonly day: string
  readonly coveredMinutes: number
  /** Uso lido no dia, por recurso, na unidade da cota. */
  readonly used: Readonly<Record<string, number>>
}

export interface UsageState {
  readonly schemaVersion: 1
  /** Início da primeira janela lida (ms). */
  readonly trackingSince: number
  /** Fim da última janela lida (ms). */
  readonly coveredUntil: number
  readonly days: readonly UsageDay[]
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Estado lido do cache; formato inesperado é erro (o chamador recomeça do zero, com aviso). */
export function parseState(raw: string): UsageState {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  const { schemaVersion, trackingSince, coveredUntil, days } = parsed
  if (
    schemaVersion !== 1 ||
    !isFiniteNonNegative(trackingSince) ||
    !isFiniteNonNegative(coveredUntil) ||
    trackingSince > coveredUntil ||
    !Array.isArray(days)
  ) {
    throw new Error('estado com formato desconhecido')
  }
  const result: UsageDay[] = []
  for (const entry of days as unknown[]) {
    const record = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >
    const used = record['used']
    if (
      typeof record['day'] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(record['day']) ||
      !isFiniteNonNegative(record['coveredMinutes']) ||
      typeof used !== 'object' ||
      used === null ||
      !Object.values(used).every(isFiniteNonNegative)
    ) {
      throw new Error('estado com um dia ilegível')
    }
    result.push({
      day: record['day'],
      coveredMinutes: record['coveredMinutes'],
      used: used as Record<string, number>,
    })
  }
  return { schemaVersion: 1, trackingSince, coveredUntil, days: result }
}

/** Primeiro instante (ms) da janela de 30 dias que termina em `at`: meia-noite UTC de 29 dias antes. */
function windowStart(at: number): number {
  return Date.parse(`${utcDay(at)}T00:00:00.000Z`) - (WINDOW_DAYS - 1) * DAY_MS
}

/**
 * Soma a janela lida no dia (UTC) do seu início e descarta os dias que saíram dos 30. Uma janela
 * que cruza a meia-noite fica inteira no dia em que começou (no máximo 22 minutos de diferença).
 */
export function addWindow(
  state: UsageState | undefined,
  window: UsageWindow,
  used: Readonly<Record<string, number>>,
): UsageState {
  const day = utcDay(window.since)
  const minutes = (window.until - window.since) / MINUTE_MS
  const oldest = utcDay(windowStart(window.until))
  const days = (state?.days ?? []).filter((entry) => entry.day >= oldest && entry.day !== day)
  const today = state?.days.find((entry) => entry.day === day)
  const summed: Record<string, number> = { ...today?.used }
  for (const [resource, value] of Object.entries(used)) {
    summed[resource] = (summed[resource] ?? 0) + value
  }
  days.push({ day, coveredMinutes: (today?.coveredMinutes ?? 0) + minutes, used: summed })
  days.sort((a, b) => (a.day < b.day ? -1 : Number(a.day > b.day)))
  return {
    schemaVersion: 1,
    trackingSince: Math.min(state?.trackingSince ?? window.since, window.since),
    coveredUntil: Math.max(state?.coveredUntil ?? window.until, window.until),
    days,
  }
}

export interface UsageRatio {
  readonly resource: string
  /** Lido nas janelas dos últimos 30 dias. */
  readonly measured: number
  /** Medido extrapolado pela cobertura. */
  readonly used: number
  readonly limit: number
  readonly unit: string
  readonly ratio: number
}

export interface UsageEstimate {
  readonly ratios: readonly UsageRatio[]
  /** Minutos lidos sobre minutos acompanhados nos 30 dias (1 = nenhuma lacuna). */
  readonly coverage: number
  /** Dias acompanhados dentro da janela de 30 (menos de 30 no começo). */
  readonly trackedDays: number
}

/** Uso de 30 dias por recurso medido, extrapolado pela cobertura (nunca reduzido). */
export function estimateUsage(state: UsageState): UsageEstimate {
  const start = Math.max(windowStart(state.coveredUntil), state.trackingSince)
  const trackedMinutes = Math.max(0, (state.coveredUntil - start) / MINUTE_MS)
  const oldest = utcDay(windowStart(state.coveredUntil))
  const days = state.days.filter((entry) => entry.day >= oldest)
  const coveredMinutes = days.reduce((sum, entry) => sum + entry.coveredMinutes, 0)
  const coverage = trackedMinutes === 0 ? 1 : Math.min(1, coveredMinutes / trackedMinutes)
  const factor = coverage === 0 ? 1 : 1 / coverage
  const ratios = USAGE_SOURCES.map((source) => {
    const quota = HOBBY_QUOTAS.find((entry) => entry.resource === source.resource)
    if (quota === undefined) {
      throw new Error(`${source.resource} sem cota em HOBBY_QUOTAS`)
    }
    const measured = days.reduce((sum, entry) => sum + (entry.used[source.resource] ?? 0), 0)
    const used = measured * factor
    return {
      resource: quota.resource,
      measured,
      used,
      limit: quota.limit,
      unit: quota.unit,
      ratio: used / quota.limit,
    }
  })
  return { ratios, coverage, trackedDays: trackedMinutes / 1440 }
}

export type GuardLevel = 'none' | 'kill-switch' | 'lockdown'

export function levelFor(ratio: number): GuardLevel {
  if (ratio >= LOCKDOWN_RATIO) {
    return 'lockdown'
  }
  return ratio >= KILL_SWITCH_RATIO ? 'kill-switch' : 'none'
}

export interface ExecResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type Exec = (
  file: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<ExecResult>

export interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: Date
  readonly fetch: typeof fetch
  readonly exec: Exec
  readonly fileExists: (path: string) => boolean
  /** Conteúdo do arquivo (`undefined`: não existe). */
  readonly readFile: (path: string) => string | undefined
  readonly writeFile: (path: string, content: string) => void
  readonly sleep: (ms: number) => Promise<void>
  readonly log: (line: string) => void
  /** Teto da espera pelo `READY` da deployment nova. */
  readonly deployTimeoutMs?: number
}

export interface Options {
  readonly dryRun: boolean
  readonly forceThreshold?: number
  readonly only?: Environment
  readonly release: boolean
}

class VercelApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Context {
  readonly deps: RunDeps
  readonly token: string
  readonly orgId: string
}

async function vercelApi(
  ctx: Context,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<unknown> {
  const url = new URL(path, VERCEL_API)
  url.searchParams.set('teamId', ctx.orgId)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value)
  }
  const response = await ctx.deps.fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${ctx.token}`,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) {
    let detail = ''
    try {
      const error = (JSON.parse(text) as { error?: { code?: unknown; message?: unknown } }).error
      detail = [error?.code, error?.message].filter((part) => typeof part === 'string').join(': ')
    } catch {
      // Corpo que não é JSON: fica só o status.
    }
    throw new VercelApiError(
      response.status,
      `${method} ${url.pathname} respondeu ${String(response.status)}${detail === '' ? '' : ` (${detail.slice(0, 200)})`}`,
    )
  }
  return text === '' ? {} : (JSON.parse(text) as unknown)
}

interface KillSwitchEnv {
  readonly on: boolean
  readonly updatedAt?: number
}

/**
 * Valor em claro da variável. A listagem (`GET /v10/projects/{id}/env`) só garante o valor em claro
 * de variável `plain` ou com `decrypted: true`; a `encrypted` pode vir cifrada mesmo com
 * `decrypt=true`, e então o valor sai do `GET /v1/projects/{id}/env/{envId}`.
 */
async function plainValue(
  ctx: Context,
  project: Project,
  entry: Record<string, unknown>,
): Promise<unknown> {
  if (entry['type'] === 'plain' || entry['decrypted'] === true) {
    return entry['value']
  }
  const id = entry['id']
  if (typeof id !== 'string') {
    throw new Error(`${project.name}: ${KILL_SWITCH} cifrada e sem id na listagem da Vercel`)
  }
  const one = (await vercelApi(ctx, 'GET', `/v1/projects/${project.id}/env/${id}`)) as Record<
    string,
    unknown
  >
  return one['value']
}

/**
 * `LLM_KILL_SWITCH` do ambiente Production do projeto (`undefined`: não existe). Valor que não é
 * `true` nem `false` é erro: tratá-lo como desligado fez a volta manual dizer "já está desligado"
 * com o kill switch ligado (exercício da F7 no staging).
 */
async function readKillSwitch(ctx: Context, project: Project): Promise<KillSwitchEnv | undefined> {
  const body = (await vercelApi(ctx, 'GET', `/v10/projects/${project.id}/env`, {
    query: { decrypt: 'true' },
  })) as { envs?: unknown }
  const envs = Array.isArray(body.envs) ? (body.envs as Record<string, unknown>[]) : []
  const entry = envs.find((env) => {
    const target = env['target']
    const targets = Array.isArray(target) ? target : [target]
    return env['key'] === KILL_SWITCH && targets.includes('production')
  })
  if (entry === undefined) {
    return undefined
  }
  const value = await plainValue(ctx, project, entry)
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized !== 'true' && normalized !== 'false') {
    throw new Error(
      `${project.name}: ${KILL_SWITCH} com valor ilegível (nem true nem false); confira no dashboard da Vercel`,
    )
  }
  const updatedAt = entry['updatedAt']
  return {
    on: normalized === 'true',
    ...(typeof updatedAt === 'number' ? { updatedAt } : {}),
  }
}

interface Deployment {
  readonly id: string
  readonly name?: string
  readonly createdAt: number
  readonly readyState?: string
}

function asDeployment(body: unknown): Deployment {
  const record = body as Record<string, unknown>
  if (typeof record['id'] !== 'string' || typeof record['createdAt'] !== 'number') {
    throw new Error('resposta da Vercel sem id ou createdAt da deployment')
  }
  return {
    id: record['id'],
    createdAt: record['createdAt'],
    ...(typeof record['name'] === 'string' ? { name: record['name'] } : {}),
    ...(typeof record['readyState'] === 'string' ? { readyState: record['readyState'] } : {}),
  }
}

/** A deployment para onde o domínio canônico aponta (`undefined`: projeto sem produção ainda). */
async function currentProduction(ctx: Context, project: Project): Promise<Deployment | undefined> {
  try {
    return asDeployment(await vercelApi(ctx, 'GET', `/v13/deployments/${project.domain}`))
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 404) {
      return undefined
    }
    throw error
  }
}

/**
 * Redeploy da deployment de produção atual (o mesmo `POST /v13/deployments` do `vercel redeploy`,
 * sem `meta`, para a nova herdar o `artifactSha256` e o `gitSha` do deploy), espera o `READY` e
 * promove se o domínio ainda não apontar para ela.
 */
async function redeploy(ctx: Context, project: Project, from: Deployment): Promise<string> {
  const created = asDeployment(
    await vercelApi(ctx, 'POST', '/v13/deployments', {
      query: { forceNew: '1' },
      body: { deploymentId: from.id, name: from.name ?? project.name, target: 'production' },
    }),
  )
  let polls = Math.ceil((ctx.deps.deployTimeoutMs ?? 15 * 60_000) / POLL_MS)
  let state = created.readyState
  while (state !== 'READY') {
    if (state === 'ERROR' || state === 'CANCELED') {
      throw new Error(`${project.name}: a deployment ${created.id} terminou em ${state}`)
    }
    if (polls <= 0) {
      throw new Error(`${project.name}: a deployment ${created.id} não ficou READY a tempo`)
    }
    polls -= 1
    await ctx.deps.sleep(POLL_MS)
    state = asDeployment(await vercelApi(ctx, 'GET', `/v13/deployments/${created.id}`)).readyState
  }
  const current = await currentProduction(ctx, project)
  if (current?.id !== created.id) {
    await vercelApi(ctx, 'POST', `/v10/projects/${project.id}/promote/${created.id}`)
  }
  return created.id
}

/**
 * Leva o `LLM_KILL_SWITCH` do projeto ao estado `on` e garante uma deployment de produção que o
 * enxergue. Devolve as linhas do plano (o que fez ou, no dry-run, o que faria).
 */
async function applyKillSwitch(
  ctx: Context,
  project: Project,
  on: boolean,
  dryRun: boolean,
): Promise<string[]> {
  const current = await readKillSwitch(ctx, project)
  const deployment = await currentProduction(ctx, project)
  const value = on ? 'true' : 'false'
  const isOn = current?.on === true
  // Sem a variável, desligar não tem o que fazer; com ela, a deployment criada depois da última
  // gravação já a enxerga (o deploy normal também, porque o env sync não toca no kill switch).
  const applied =
    current === undefined ||
    current.updatedAt === undefined ||
    deployment === undefined ||
    deployment.createdAt >= current.updatedAt
  if (isOn === on && applied) {
    return [`${project.name}: ${KILL_SWITCH} já está ${on ? 'ligado' : 'desligado'}; nada a fazer`]
  }
  const plan: string[] = []
  if (isOn !== on) {
    plan.push(`${project.name}: gravar ${KILL_SWITCH}=${value} (Production)`)
    if (!dryRun) {
      await vercelApi(ctx, 'POST', `/v10/projects/${project.id}/env`, {
        query: { upsert: 'true' },
        body: {
          key: KILL_SWITCH,
          value,
          // true/false não é segredo: `plain` volta em claro na listagem que o readKillSwitch lê.
          type: 'plain',
          target: ['production'],
          comment: 'Guarda de uso (scripts/vercel-usage.ts); runbook budget-kill-switch.md',
        },
      })
    }
  }
  if (deployment === undefined) {
    plan.push(`${project.name}: sem deployment de produção; a variável vale no próximo deploy`)
    return plan
  }
  plan.push(`${project.name}: redeploy da deployment de produção ${deployment.id}`)
  if (!dryRun) {
    const id = await redeploy(ctx, project, deployment)
    plan.push(`${project.name}: deployment ${id} READY no domínio ${project.domain}`)
  }
  return plan
}

const CHILD_ENV_PASSTHROUGH = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'TMP',
  'CI',
  'GITHUB_ACTIONS',
  'RUNNER_TEMP',
] as const

/** Env mínimo dos processos filhos: nada da credencial OTLP nem do resto do job. */
function childEnv(ctx: Context): Record<string, string> {
  const env: Record<string, string> = {
    VERCEL_TOKEN: ctx.token,
    VERCEL_ORG_ID: ctx.orgId,
    VERCEL_TELEMETRY_DISABLED: '1',
    NO_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1',
  }
  for (const name of CHILD_ENV_PASSTHROUGH) {
    const value = ctx.deps.env[name]
    if (value !== undefined) {
      env[name] = value
    }
  }
  return env
}

function forwardOutput(ctx: Context, result: ExecResult): void {
  for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/u)) {
    if (line.trim() !== '') {
      // O filho não emite comando do Actions por este processo (o `::` vira texto).
      ctx.deps.log(`  ${line.replaceAll('::', ': :')}`)
    }
  }
}

async function setLockdown(
  ctx: Context,
  project: Project,
  on: boolean,
  dryRun: boolean,
): Promise<string> {
  if (!ctx.deps.fileExists(FIREWALL_SCRIPT)) {
    throw new Error('scripts/vercel-firewall.ts não existe neste checkout: lockdown não aplicado')
  }
  const args = [
    FIREWALL_SCRIPT,
    '--env',
    project.environment,
    '--lockdown',
    on ? 'on' : 'off',
    ...(dryRun ? ['--dry-run'] : []),
  ]
  const result = await ctx.deps.exec(process.execPath, args, childEnv(ctx))
  forwardOutput(ctx, result)
  if (result.code !== 0) {
    throw new Error(
      `${project.name}: vercel-firewall.ts --lockdown ${on ? 'on' : 'off'} saiu com ${String(result.code)}`,
    )
  }
  return `${project.name}: lockdown ${on ? 'ligado' : 'desligado'} (regra 1 do WAF)${dryRun ? ' [dry-run]' : ''}`
}

/** Uso da janela por recurso medido, uma chamada do `vercel metrics` por métrica. */
async function readWindow(ctx: Context, window: UsageWindow): Promise<Record<string, number>> {
  if (!ctx.deps.fileExists(VERCEL_CLI)) {
    throw new Error(
      'Vercel CLI ausente: rode pnpm --dir tools/vercel-cli install --frozen-lockfile antes',
    )
  }
  const used: Record<string, number> = {}
  for (const source of USAGE_SOURCES) {
    const result = await ctx.deps.exec(
      process.execPath,
      [
        VERCEL_CLI,
        'metrics',
        source.metric,
        '--all',
        '--aggregation',
        source.aggregation,
        '--since',
        new Date(window.since).toISOString(),
        '--until',
        new Date(window.until).toISOString(),
        '--granularity',
        '1m',
        '--json',
        '--scope',
        ctx.orgId,
      ],
      childEnv(ctx),
    )
    if (result.code !== 0) {
      // O erro do CLI vem em JSON no stdout (`{ error: { code, message } }`); sem ele, o stderr.
      let parsedError: Error | undefined
      try {
        parseMetricsOutput(result.stdout, source)
      } catch (error) {
        parsedError = error instanceof Error ? error : undefined
      }
      if (parsedError !== undefined && !parsedError.message.endsWith('saída não é JSON')) {
        throw new Error(`${parsedError.message} (saiu com ${String(result.code)})`)
      }
      forwardOutput(ctx, { code: result.code, stdout: '', stderr: result.stderr })
      throw new Error(`vercel metrics ${source.metric} saiu com ${String(result.code)}`)
    }
    used[source.resource] = parseMetricsOutput(result.stdout, source)
  }
  return used
}

/** Estado anterior; ausente ou ilegível recomeça do zero (com aviso no segundo caso). */
function loadState(ctx: Context): { state?: UsageState; warning?: string } {
  const raw = ctx.deps.readFile(STATE_FILE)
  if (raw === undefined) {
    return {}
  }
  try {
    return { state: parseState(raw) }
  } catch (error) {
    return { warning: `estado ilegível (${errorMessage(error)}); recomeçando do zero` }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Aplica o nível nos projetos; cada falha fica registrada sem impedir o projeto seguinte. */
async function act(
  ctx: Context,
  targets: readonly Project[],
  level: GuardLevel | 'release',
  dryRun: boolean,
): Promise<{ plan: string[]; failures: string[] }> {
  const plan: string[] = []
  const failures: string[] = []
  if (level === 'none') {
    return { plan, failures }
  }
  for (const project of targets) {
    const steps: (() => Promise<string | string[]>)[] = []
    if (level === 'lockdown') {
      // Primeiro o WAF (efeito imediato), depois o kill switch (espera o redeploy).
      steps.push(() => setLockdown(ctx, project, true, dryRun))
    }
    steps.push(() => applyKillSwitch(ctx, project, level !== 'release', dryRun))
    if (level === 'release') {
      steps.push(() => setLockdown(ctx, project, false, dryRun))
    }
    for (const step of steps) {
      try {
        plan.push(...[await step()].flat())
      } catch (error) {
        failures.push(errorMessage(error))
      }
    }
  }
  return { plan, failures }
}

function round(value: number, digits = 3): string {
  const factor = 10 ** digits
  return String(Math.round(value * factor) / factor)
}

function ratioLine(ratio: UsageRatio): string {
  return `| ${ratio.resource} | ${round(ratio.measured)} ${ratio.unit} | ${round(ratio.used)} ${ratio.unit} | ${String(ratio.limit)} ${ratio.unit} | ${round(ratio.ratio * 100, 1)}% |`
}

/** Recursos com cota e sem fonte no Hobby: aparecem no resumo, fora da guarda. */
function unmeasuredLines(): string[] {
  const measured = new Set(USAGE_SOURCES.map((source) => source.resource))
  return HOBBY_QUOTAS.filter((quota) => !measured.has(quota.resource)).map(
    (quota) =>
      `| ${quota.resource} | sem fonte no Hobby | — | ${String(quota.limit)} ${quota.unit} | — |`,
  )
}

interface Measurement {
  readonly ratios: readonly UsageRatio[]
  readonly level: GuardLevel
}

/**
 * Lê a janela nova, soma no estado (gravado fora do dry-run) e estima os 30 dias. Falha da fonte
 * não avança o estado: a janela perdida vira lacuna na cobertura.
 */
async function measure(
  ctx: Context,
  dryRun: boolean,
  summary: string[],
  failures: string[],
): Promise<Measurement | undefined> {
  const loaded = loadState(ctx)
  if (loaded.warning !== undefined) {
    ctx.deps.log(`::warning title=${TITLE}::${loaded.warning}`)
  }
  let state = loaded.state
  const window = planWindow(ctx.deps.now, state?.coveredUntil)
  if (window === undefined) {
    summary.push('Nenhum minuto novo desde a última leitura.', '')
  } else {
    try {
      const used = await readWindow(ctx, window)
      state = addWindow(state, window, used)
      summary.push(
        `Janela lida: ${new Date(window.since).toISOString()} a ${new Date(window.until).toISOString()}.`,
        '',
      )
    } catch (error) {
      failures.push(`fonte de uso não respondeu: ${errorMessage(error)}`)
      summary.push(
        '**A fonte de uso não respondeu: guarda sem leitura nesta execução** (runbook `budget-kill-switch.md`).',
        '',
      )
      return undefined
    }
    if (!dryRun) {
      ctx.deps.writeFile(STATE_FILE, `${JSON.stringify(state)}\n`)
    }
  }
  if (state === undefined) {
    summary.push('Sem estado: nada medido ainda.', '')
    return { ratios: [], level: 'none' }
  }
  const estimate = estimateUsage(state)
  summary.push(
    '| Recurso | Lido (30 dias) | Estimado (30 dias) | Cota Hobby | % |',
    '|---|---|---|---|---|',
    ...estimate.ratios.map(ratioLine),
    ...unmeasuredLines(),
    '',
    `Cobertura: ${round(estimate.coverage * 100, 1)}% de ${round(estimate.trackedDays, 1)} dia(s) acompanhados.`,
    '',
  )
  if (estimate.coverage < LOW_COVERAGE) {
    ctx.deps.log(
      `::warning title=${TITLE}::cobertura de ${round(estimate.coverage * 100, 1)}% nos 30 dias: a estimativa extrapola lacunas grandes (cron atrasado ou falhas)`,
    )
  }
  const max = Math.max(0, ...estimate.ratios.map((ratio) => ratio.ratio))
  return { ratios: estimate.ratios, level: levelFor(max) }
}

/** Código de saída: 0 ok (ou só avisos), 1 leitura, ação ou envio falhou. */
export async function run(
  deps: RunDeps,
  options: Options,
): Promise<{ code: number; summary: string[] }> {
  const mode = options.release
    ? 'release'
    : options.forceThreshold === undefined
      ? 'medição'
      : `exercício ${String(options.forceThreshold)}`
  const summary = [`### vercel-usage (${mode}${options.dryRun ? ', dry-run' : ''})`, '']
  const token = envValue(deps.env, 'VERCEL_TOKEN')
  if (token === undefined) {
    deps.log(
      `::warning title=${TITLE}::sem VERCEL_USAGE_TOKEN no environment ops: uso da Vercel não medido e kill switch automático inativo (runbook budget-kill-switch.md)`,
    )
    summary.push('Sem `VERCEL_USAGE_TOKEN`: nada foi lido.')
    return { code: 0, summary }
  }
  const orgId = envValue(deps.env, 'VERCEL_ORG_ID')
  if (orgId === undefined || !ORG_ID.test(orgId)) {
    deps.log(
      `::error title=${TITLE}::VERCEL_ORG_ID ausente ou inválido no environment ops (ID do time, team_...)`,
    )
    summary.push('`VERCEL_ORG_ID` ausente ou inválido.')
    return { code: 1, summary }
  }
  const ctx: Context = { deps, token, orgId }
  const targets = PROJECTS.filter(
    (project) => options.only === undefined || project.environment === options.only,
  )
  const failures: string[] = []
  const points: GaugePoint[] = []
  let level: GuardLevel | 'release'

  if (options.release) {
    level = 'release'
  } else if (options.forceThreshold === undefined) {
    const measured = await measure(ctx, options.dryRun, summary, failures)
    level = measured?.level ?? 'none'
    points.push(
      ...(measured?.ratios ?? []).map((ratio) => ({
        name: 'teko_vercel_usage_ratio',
        value: ratio.ratio,
        labels: { resource: ratio.resource },
        description:
          'Uso estimado dos últimos 30 dias sobre a cota do Hobby (conta inteira; vercel metrics acumulado)',
      })),
    )
  } else {
    level = levelFor(options.forceThreshold)
  }

  summary.push(`Nível: **${level}** em ${targets.map((project) => project.name).join(', ')}.`, '')
  const acted = await act(ctx, targets, level, options.dryRun)
  failures.push(...acted.failures)
  for (const line of acted.plan) {
    deps.log(line)
  }
  summary.push(...acted.plan.map((line) => `- ${line}`))

  if (options.forceThreshold === undefined && !options.release) {
    if (failures.length === 0) {
      points.push({
        name: 'teko_ops_job_last_success_timestamp_seconds',
        value: Math.floor(deps.now.getTime() / 1000),
        labels: { ops_job: 'vercel-usage' },
        description: 'Instante do último sucesso de um job do ops.yml',
      })
    }
    const published = await publishPoints(points, deps, {
      dryRun: options.dryRun,
      serviceName: SERVICE_NAME,
      title: TITLE,
    })
    summary.push('', ...published.summary)
    if (!published.ok) {
      failures.push('envio OTLP falhou')
    }
  }
  for (const failure of failures) {
    deps.log(`::error title=${TITLE}::${failure.replaceAll('::', ': :')}`)
  }
  return { code: failures.length === 0 ? 0 : 1, summary }
}

const FORCE_THRESHOLDS: Readonly<Record<string, number>> = {
  '0.85': KILL_SWITCH_RATIO,
  '0.95': LOCKDOWN_RATIO,
}

/** Argumentos da linha de comando → opções; só valores de um conjunto constante passam. */
export function parseOptions(args: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'dry-run': { type: 'boolean', default: false },
      'force-threshold': { type: 'string' },
      only: { type: 'string' },
      release: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  const force = values['force-threshold']
  if (force !== undefined && FORCE_THRESHOLDS[force] === undefined) {
    throw new RangeError('--force-threshold aceita só 0.85 ou 0.95')
  }
  if (force !== undefined && values.release) {
    throw new RangeError('--force-threshold e --release são exclusivos')
  }
  const only = values.only
  if (only !== undefined && only !== 'staging' && only !== 'production') {
    throw new RangeError('--only aceita só staging ou production')
  }
  if (only !== undefined && force === undefined && !values.release) {
    throw new RangeError(
      '--only só vale com --force-threshold ou --release (a cota é da conta inteira)',
    )
  }
  return {
    dryRun: values['dry-run'],
    release: values.release,
    ...(force === undefined ? {} : { forceThreshold: FORCE_THRESHOLDS[force] }),
    ...(only === undefined ? {} : { only }),
  }
}

const execProcess: Exec = (file, args, env) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env, maxBuffer: 16 * 1024 * 1024, timeout: 180_000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2))
  const { code, summary } = await run(
    {
      env: process.env,
      now: new Date(),
      fetch,
      exec: execProcess,
      fileExists: existsSync,
      readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
      writeFile: (path, content) => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, content)
      },
      sleep: (ms) => delay(ms),
      log: logLine,
    },
    options,
  )
  const summaryFile = process.env['GITHUB_STEP_SUMMARY']
  if (summaryFile) {
    appendFileSync(summaryFile, `${summary.join('\n')}\n`)
  } else {
    console.log(summary.join('\n'))
  }
  return code
}

if (import.meta.main) {
  exit(await main())
}
