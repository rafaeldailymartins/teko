/**
 * Job `vercel-usage` do `.github/workflows/ops.yml` (F7, mudança OpenSpec `add-usage-guard`): guarda
 * de uso da conta Vercel Hobby (`docs/architecture/contas-e-cotas.md`, "Guard rails").
 *
 * 1. Lê o uso dos últimos 30 dias da conta com o Vercel CLI isolado de `tools/vercel-cli`
 *    (`vercel billing usage --since 30d --json`; o `vercel usage` da arquitetura virou subcomando de
 *    `billing`). A saída traz o uso, não o saldo: as cotas do Hobby ficam fixadas aqui
 *    (`HOBBY_QUOTAS`) e a razão uso/cota de cada recurso sai como `teko_vercel_usage_ratio{resource}`
 *    por OTLP (`scripts/lib/otlp-metrics.ts`), junto com o sucesso do job.
 * 2. **85%** em qualquer recurso: kill switch de geração. Grava `LLM_KILL_SWITCH=true` (Production)
 *    nos dois projetos e redeploya a deployment de produção atual de cada um (env var só vale em
 *    deployment nova). **95%**: além disso, `scripts/vercel-firewall.ts --lockdown on` nos dois
 *    projetos (a regra 1 do WAF passa a negar tudo exceto `/healthz` e a página de aviso).
 * 3. Nunca desliga nada sozinho: a volta é manual (`--release`, runbook `budget-kill-switch.md`).
 *    Idempotente: com o kill switch já ligado e a deployment de produção mais nova que a variável,
 *    não grava nem redeploya de novo.
 *
 * Modos:
 *   node scripts/vercel-usage.ts [--dry-run]
 *   node scripts/vercel-usage.ts --force-threshold 0.85|0.95 [--only staging|production] [--dry-run]
 *   node scripts/vercel-usage.ts --release [--only staging|production] [--dry-run]
 *
 * `--force-threshold` age como se o uso tivesse chegado ao limiar, sem ler o uso nem enviar
 * métricas: é o exercício do DoD da F7 no staging. `--release` desliga o kill switch (com redeploy)
 * e o lockdown. `--dry-run` só lê e mostra o plano.
 *
 * Ambiente: `VERCEL_TOKEN` (no workflow, o segredo `VERCEL_USAGE_TOKEN` do environment `ops`),
 * `VERCEL_ORG_ID` (o time Hobby) e a credencial OTLP do `ops`. Sem `VERCEL_TOKEN`, avisa e sai com 0.
 * Os projetos e o CLI são constantes; nenhum caminho nem executável vem da linha de comando
 * (`scripts/lib/cli-guards.ts`).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
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
const VERCEL_API = 'https://api.vercel.com'
const SERVICE_NAME = 'teko-ops'
const TITLE = 'vercel-usage'
const KILL_SWITCH = 'LLM_KILL_SWITCH'
/** ID do time (`team_...`); só o formato, para nada estranho entrar na URL nem nos argumentos. */
const ORG_ID = /^[A-Za-z0-9_]{1,64}$/u
const POLL_MS = 10_000

export const KILL_SWITCH_RATIO = 0.85
export const LOCKDOWN_RATIO = 0.95

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

type QuantityKind = 'count' | 'gb_hours' | 'gigabytes' | 'hours'

export interface Quota {
  /** Label `resource` da métrica. */
  readonly resource: string
  readonly limit: number
  /** Unidade do `limit` (só para o resumo). */
  readonly unit: string
  readonly kind: QuantityKind
  /** Casa o nome (ou o slug do produto) normalizado: minúsculas, só letras, dígitos e espaços. */
  readonly match: RegExp
}

/**
 * Cotas mensais da conta Hobby, somando os dois projetos. Fonte: https://vercel.com/docs/plans/hobby
 * ("Hobby Plan Included Usage", lida pelo Context7 `/websites/vercel` em 2026-11-18) e a tabela da
 * Vercel em `docs/architecture/contas-e-cotas.md`. Deployment storage não é uso mensal e fica na
 * checagem manual mensal; linha do relatório sem cota aqui vira aviso no resumo do job.
 */
export const HOBBY_QUOTAS: readonly Quota[] = [
  {
    resource: 'provisioned_memory',
    limit: 360,
    unit: 'GB-h',
    kind: 'gb_hours',
    match: /^(?:fluid |function )?provisioned memory$/u,
  },
  {
    resource: 'active_cpu',
    limit: 4,
    unit: 'h',
    kind: 'hours',
    match: /^(?:fluid |function )?active cpu$/u,
  },
  {
    resource: 'function_invocations',
    limit: 1_000_000,
    unit: 'invocações',
    kind: 'count',
    match: /^(?:fluid |function |functions )?invocations?$/u,
  },
  {
    resource: 'fast_origin_transfer',
    limit: 10,
    unit: 'GB',
    kind: 'gigabytes',
    match: /^fast origin transfer$/u,
  },
  {
    resource: 'fast_data_transfer',
    limit: 100,
    unit: 'GB',
    kind: 'gigabytes',
    match: /^fast data transfer$/u,
  },
  {
    resource: 'cdn_requests',
    limit: 1_000_000,
    unit: 'requests',
    kind: 'count',
    match: /^(?:cdn|edge) requests?$/u,
  },
  {
    // Spans de infraestrutura da Vercel (o Tekó não usa @vercel/otel); a cota vem da tabela de
    // contas-e-cotas.md. Nome provável no relatório; outro nome aparece como aviso no resumo.
    resource: 'tracing_spans',
    limit: 1_000_000,
    unit: 'spans',
    kind: 'count',
    match: /^(?:tracing |trace |traces )?spans?$/u,
  },
  {
    resource: 'image_transformations',
    limit: 5000,
    unit: 'transformações',
    kind: 'count',
    match: /^image (?:optimization )?transformations?$/u,
  },
  {
    resource: 'image_cache_reads',
    limit: 300_000,
    unit: 'leituras',
    kind: 'count',
    match: /^image (?:optimization )?cache reads?$/u,
  },
  {
    resource: 'image_cache_writes',
    limit: 100_000,
    unit: 'escritas',
    kind: 'count',
    match: /^image (?:optimization )?cache writes?$/u,
  },
]

export interface UsageService {
  readonly name: string
  readonly product?: string
  readonly quantity: number
  readonly unit?: string
  readonly category?: string
}

/**
 * JSON do `vercel billing usage --json` (Vercel CLI 65.11.0, `serializeService`):
 * `{ period, context, costUnit, services: [{ name, product, quantity, unit, cost, included,
 * category }], totals }`. Tolerante: aceita lixo antes do objeto, ignora campos desconhecidos e
 * entradas sem nome ou quantidade numérica, e lê `usage` ou `value` se `quantity` sumir.
 */
export function parseUsageReport(raw: string): UsageService[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end <= start) {
      throw new Error('saída do vercel billing usage não é JSON')
    }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch {
      throw new Error('saída do vercel billing usage não é JSON')
    }
  }
  const services = (parsed as { services?: unknown } | null)?.services
  if (!Array.isArray(services)) {
    throw new Error('saída do vercel billing usage sem a lista "services"')
  }
  const result: UsageService[] = []
  for (const entry of services as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const record = entry as Record<string, unknown>
    const quantity = [record['quantity'], record['usage'], record['value']].find(
      (candidate): candidate is number =>
        typeof candidate === 'number' && Number.isFinite(candidate),
    )
    const name = typeof record['name'] === 'string' ? record['name'] : undefined
    const product = typeof record['product'] === 'string' ? record['product'] : undefined
    if (quantity === undefined || (name === undefined && product === undefined)) {
      continue
    }
    result.push({
      name: name ?? product ?? '',
      ...(product === undefined ? {} : { product }),
      quantity,
      ...(typeof record['unit'] === 'string' ? { unit: record['unit'] } : {}),
      ...(typeof record['category'] === 'string' ? { category: record['category'] } : {}),
    })
  }
  return result
}

/** `Fluid Provisioned-Memory`, `fluidProvisionedMemory` → `fluid provisioned memory`. */
function normalizeName(text: string): string {
  return text
    .replaceAll(/([a-z])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim()
}

function quotaOf(service: UsageService): Quota | undefined {
  const candidates = [service.name, service.product ?? ''].map(normalizeName)
  return HOBBY_QUOTAS.find((quota) => candidates.some((name) => quota.match.test(name)))
}

/** Unidade normalizada → [multiplicador, divisor] até a unidade da cota (frações exatas). */
const UNIT_FACTORS: Readonly<
  Record<QuantityKind, Readonly<Record<string, readonly [number, number]>>>
> = {
  gb_hours: {
    gbhrs: [1, 1],
    gbhr: [1, 1],
    gbhours: [1, 1],
    gbhour: [1, 1],
    gbh: [1, 1],
    mbhrs: [1, 1000],
    mbhr: [1, 1000],
    mbhours: [1, 1000],
    mbh: [1, 1000],
    gbs: [1, 3600],
    gbsec: [1, 3600],
    gbseconds: [1, 3600],
  },
  hours: {
    hrs: [1, 1],
    hr: [1, 1],
    hours: [1, 1],
    hour: [1, 1],
    h: [1, 1],
    cpuhrs: [1, 1],
    cpuhours: [1, 1],
    cpuh: [1, 1],
    min: [1, 60],
    mins: [1, 60],
    minutes: [1, 60],
    s: [1, 3600],
    sec: [1, 3600],
    secs: [1, 3600],
    seconds: [1, 3600],
    ms: [1, 3_600_000],
    milliseconds: [1, 3_600_000],
  },
  gigabytes: {
    b: [1, 1e9],
    bytes: [1, 1e9],
    kb: [1, 1e6],
    mb: [1, 1e3],
    gb: [1, 1],
    tb: [1e3, 1],
    kib: [1024, 1e9],
    mib: [1024 ** 2, 1e9],
    gib: [1024 ** 3, 1e9],
    tib: [1024 ** 4, 1e9],
  },
  count: { k: [1e3, 1], thousand: [1e3, 1], m: [1e6, 1], million: [1e6, 1] },
}

/**
 * Quantidade na unidade da cota. Contagens aceitam qualquer unidade em palavra (`invocations`,
 * `requests`) ou nenhuma; tempo, memória e transferência exigem uma unidade conhecida, para uma
 * mudança de unidade na Vercel virar falha visível e não uma razão errada.
 */
export function toQuotaUnit(quota: Quota, service: UsageService): number {
  const unit = (service.unit ?? '').toLowerCase().replaceAll(/[\s_-]+/gu, '')
  const factor = UNIT_FACTORS[quota.kind][unit]
  if (factor !== undefined) {
    return (service.quantity * factor[0]) / factor[1]
  }
  if (quota.kind === 'count') {
    return service.quantity
  }
  throw new RangeError(
    `${quota.resource}: unidade desconhecida "${service.unit ?? '(nenhuma)'}" em "${service.name}"`,
  )
}

export interface UsageRatio {
  readonly resource: string
  readonly used: number
  readonly limit: number
  readonly unit: string
  readonly ratio: number
}

/**
 * Razão uso/cota por recurso conhecido (soma das linhas que casam; recurso ausente vale 0). Falha
 * de unidade fica só naquele recurso. Linhas sem cota fixada voltam em `unknown` (aviso), e um
 * relatório com linhas mas nenhuma reconhecida é falha (formato mudou).
 */
export function usageRatios(services: readonly UsageService[]): {
  ratios: UsageRatio[]
  failures: string[]
  unknown: string[]
} {
  const used = new Map<string, number>()
  const failed = new Set<string>()
  const failures: string[] = []
  const unknown: string[] = []
  let recognized = 0
  for (const service of services) {
    if (service.category === 'subscription') {
      continue
    }
    const quota = quotaOf(service)
    if (quota === undefined) {
      if (service.quantity !== 0) {
        unknown.push(service.name)
      }
      continue
    }
    recognized += 1
    try {
      used.set(quota.resource, (used.get(quota.resource) ?? 0) + toQuotaUnit(quota, service))
    } catch (error) {
      failed.add(quota.resource)
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (recognized === 0 && services.some((service) => service.category !== 'subscription')) {
    failures.push(
      'nenhum recurso do relatório casou com as cotas do Hobby (formato do vercel billing usage mudou?)',
    )
  }
  const ratios = HOBBY_QUOTAS.filter((quota) => !failed.has(quota.resource)).map((quota) => {
    const value = used.get(quota.resource) ?? 0
    return {
      resource: quota.resource,
      used: value,
      limit: quota.limit,
      unit: quota.unit,
      ratio: value / quota.limit,
    }
  })
  return { ratios, failures, unknown }
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

async function readUsage(ctx: Context): Promise<UsageService[]> {
  if (!ctx.deps.fileExists(VERCEL_CLI)) {
    throw new Error(
      'Vercel CLI ausente: rode pnpm --dir tools/vercel-cli install --frozen-lockfile antes',
    )
  }
  const result = await ctx.deps.exec(
    process.execPath,
    [VERCEL_CLI, 'billing', 'usage', '--since', '30d', '--json', '--scope', ctx.orgId],
    childEnv(ctx),
  )
  if (result.code !== 0) {
    forwardOutput(ctx, { code: result.code, stdout: '', stderr: result.stderr })
    throw new Error(`vercel billing usage saiu com ${String(result.code)}`)
  }
  return parseUsageReport(result.stdout)
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

function ratioLine(ratio: UsageRatio): string {
  const percent = Math.round(ratio.ratio * 1000) / 10
  const used = Math.round(ratio.used * 1000) / 1000
  return `| ${ratio.resource} | ${String(used)} ${ratio.unit} | ${String(ratio.limit)} ${ratio.unit} | ${String(percent)}% |`
}

/** Código de saída: 0 ok (ou só avisos), 1 leitura, ação ou envio falhou. */
export async function run(
  deps: RunDeps,
  options: Options,
): Promise<{ code: number; summary: string[] }> {
  const mode = options.release
    ? 'release'
    : options.forceThreshold === undefined
      ? 'diário'
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
    level = 'none'
    try {
      const services = await readUsage(ctx)
      const result = usageRatios(services)
      failures.push(...result.failures)
      for (const name of result.unknown) {
        deps.log(`::warning title=${TITLE}::sem cota fixada para "${name}" (só no resumo)`)
      }
      summary.push(
        '| Recurso | Uso (30 dias) | Cota Hobby | % |',
        '|---|---|---|---|',
        ...result.ratios.map(ratioLine),
        '',
      )
      const max = Math.max(0, ...result.ratios.map((ratio) => ratio.ratio))
      level = levelFor(max)
      points.push(
        ...result.ratios.map((ratio) => ({
          name: 'teko_vercel_usage_ratio',
          value: ratio.ratio,
          labels: { resource: ratio.resource },
          description: 'Uso dos últimos 30 dias sobre a cota mensal do Hobby (conta inteira)',
        })),
      )
    } catch (error) {
      failures.push(errorMessage(error))
    }
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
    deps.log(`::error title=${TITLE}::${failure}`)
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
