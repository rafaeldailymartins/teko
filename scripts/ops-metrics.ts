/**
 * Job `quotas` do `.github/workflows/ops.yml` (F6): calcula as métricas de cota que a API não emite
 * e as empurra por OTLP/HTTP ao Grafana Cloud (`scripts/lib/otlp-metrics.ts`).
 *
 * | Métrica                                       | Labels                                   | Fonte                                                 |
 * | --------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- |
 * | `teko_neon_compute_hours`                     | `project`, ambiente                      | `compute_time_seconds` do período (API do Neon)       |
 * | `teko_neon_cu_hours_ratio`                    | `project`, ambiente                      | projeção linear do período sobre 100 CU-h             |
 * | `teko_neon_data_transfer_ratio`               | `project`, ambiente                      | `data_transfer_bytes` do período sobre 5 GB           |
 * | `teko_token_expiry_days`                      | `token`                                  | variável `TOKEN_EXPIRY_DATES` (JSON nome → data)      |
 * | `teko_coverage_verified_age_days`             | `family`, ambiente                       | JSON do `cli coverage-age` (job `coverage-age`)       |
 * | `teko_ops_job_last_success_timestamp_seconds` | `ops_job`                                | o próprio job, ao terminar sem erro                   |
 *
 * A API do Neon (`GET /projects/{id}`) não acorda o compute. Fonte não configurada é pulada com
 * aviso (o environment `ops` pode estar vazio); fonte configurada que falha deixa o job vermelho
 * depois de enviar o resto. Sem a credencial OTLP, as métricas só são impressas.
 *
 * Uso: node scripts/ops-metrics.ts [--dry-run] [--job quotas] [--success-only]
 *
 * `--success-only` não lê fonte nenhuma e só registra o sucesso de `--job`: é o caminho do
 * `weekly-maintenance`, cujo purge roda no environment `maintenance`, sem a credencial OTLP.
 */
import { appendFileSync } from 'node:fs'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import { envValue, type GaugePoint, logLine, publishPoints } from './lib/otlp-metrics.ts'

/** Cota do Neon Free por projeto e por mês (docs/architecture/contas-e-cotas.md). */
export const NEON_CU_HOURS_QUOTA = 100
/**
 * Transferência pública (egress) do Neon Free por projeto e por mês: 5 GB, em base decimal (a API
 * manda dividir `data_transfer_bytes` por 1.000.000.000). Estourar suspende o compute até o ciclo
 * virar (incidente do staging em 2026-11-18; docs/runbooks/neon-suspended.md).
 */
export const NEON_TRANSFER_QUOTA_BYTES = 5_000_000_000
const NEON_API = 'https://console.neon.tech/api/v2'
const PROJECT_ID = /^[a-z0-9-]{1,64}$/u
const TOKEN_NAME = /^[A-Za-z0-9_.@:() -]{1,64}$/u
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const DAY_MS = 86_400_000
const SERVICE_NAME = 'teko-ops'

type Environment = 'production' | 'staging'

export interface NeonProjectUsage {
  readonly compute_time_seconds: number
  /** Transferência do período (pública e privada; no Free só há a pública), em bytes. */
  readonly data_transfer_bytes: number
  readonly consumption_period_start: string
  readonly consumption_period_end?: string | null
}

function utcDay(date: string): number {
  if (!ISO_DATE.test(date)) {
    throw new RangeError(`data inválida: ${date}`)
  }
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`data inválida: ${date}`)
  }
  return ms
}

/** Data de hoje em `America/Sao_Paulo` (a data do `verified_at` também é desse fuso). */
export function todayInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS)
}

function addOneMonth(start: Date): Date {
  const end = new Date(start)
  end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

/**
 * CU-h do período e a projeção linear sobre a cota: `usado / fração decorrida / 100`. A fração
 * tem piso de um dia, para o primeiro dia do ciclo não projetar um mês inteiro de poucas horas.
 */
export function neonUsagePoints(
  project: { readonly name: string; readonly environment: Environment },
  usage: NeonProjectUsage,
  now: Date,
): GaugePoint[] {
  const start = new Date(usage.consumption_period_start)
  if (Number.isNaN(start.getTime())) {
    throw new RangeError(`${project.name}: consumption_period_start inválido`)
  }
  const end = usage.consumption_period_end
    ? new Date(usage.consumption_period_end)
    : addOneMonth(start)
  const period = end.getTime() - start.getTime()
  if (!(period > 0)) {
    throw new RangeError(`${project.name}: período de consumo inválido`)
  }
  const elapsed = Math.min(Math.max(now.getTime() - start.getTime(), DAY_MS), period)
  const used = usage.compute_time_seconds / 3600
  const labels = { project: project.name }
  return [
    {
      name: 'teko_neon_compute_hours',
      value: used,
      labels,
      environment: project.environment,
      description: 'CU-h do período de cobrança do Neon (aproximado)',
    },
    {
      name: 'teko_neon_cu_hours_ratio',
      value: used / (elapsed / period) / NEON_CU_HOURS_QUOTA,
      labels,
      environment: project.environment,
      description: 'Projeção linear dos CU-h do período sobre a cota de 100 CU-h',
    },
    {
      // Valor do período, sem projeção: o estouro suspende o compute na hora, e o gasto vem em
      // rajadas (ingestão, snapshot, corpus-eval), não em ritmo constante.
      name: 'teko_neon_data_transfer_ratio',
      value: neonTransferRatio(usage.data_transfer_bytes),
      labels,
      environment: project.environment,
      description: 'Transferência pública do período do Neon sobre a cota de 5 GB do Free',
    },
  ]
}

/** Fração da cota de transferência do Free já usada no período. */
export function neonTransferRatio(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`data_transfer_bytes inválido: ${String(bytes)}`)
  }
  return bytes / NEON_TRANSFER_QUOTA_BYTES
}

/** `{"VERCEL_TOKEN (staging)": "2027-02-10", ...}` → dias até a expiração (negativo = vencido). */
export function tokenExpiryPoints(raw: string, today: string): GaugePoint[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RangeError('TOKEN_EXPIRY_DATES não é JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new RangeError('TOKEN_EXPIRY_DATES precisa ser um objeto {"nome": "AAAA-MM-DD"}')
  }
  return Object.entries(parsed).map(([token, date]) => {
    if (!TOKEN_NAME.test(token)) {
      throw new RangeError(`TOKEN_EXPIRY_DATES: nome inválido "${token}"`)
    }
    if (typeof date !== 'string') {
      throw new RangeError(`TOKEN_EXPIRY_DATES: data de "${token}" não é texto`)
    }
    return {
      name: 'teko_token_expiry_days',
      value: daysBetween(today, date),
      labels: { token },
      description: 'Dias até a expiração do token (TOKEN_EXPIRY_DATES)',
    }
  })
}

interface CoverageAgeDatabase {
  readonly name: string
  readonly environment: Environment
  readonly families: readonly { readonly family: string; readonly verifiedAt: string }[]
  readonly error?: string
}

/** JSON do `cli coverage-age` → idade do `verified_at` em dias, por família e ambiente. */
export function coverageAgePoints(
  raw: string,
  today: string,
): { points: GaugePoint[]; errors: string[] } {
  const report = JSON.parse(raw) as { schemaVersion?: unknown; databases?: unknown }
  if (report.schemaVersion !== 1 || !Array.isArray(report.databases)) {
    throw new RangeError('relatório do coverage-age em formato desconhecido')
  }
  const points: GaugePoint[] = []
  const errors: string[] = []
  for (const database of report.databases as CoverageAgeDatabase[]) {
    if (database.environment !== 'production' && database.environment !== 'staging') {
      throw new RangeError(`coverage-age: ambiente desconhecido em ${String(database.name)}`)
    }
    if (database.error !== undefined) {
      errors.push(`${database.name}: ${database.error}`)
    }
    for (const { family, verifiedAt } of database.families) {
      points.push({
        name: 'teko_coverage_verified_age_days',
        value: daysBetween(verifiedAt, today),
        labels: { family },
        environment: database.environment,
        description: 'Dias desde o último verified_at da família (corpus.coverage)',
      })
    }
  }
  return { points, errors }
}

export function jobSuccessPoint(job: string, now: Date): GaugePoint {
  return {
    name: 'teko_ops_job_last_success_timestamp_seconds',
    value: Math.floor(now.getTime() / 1000),
    labels: { ops_job: job },
    description: 'Instante do último sucesso de um job do ops.yml',
  }
}

export interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: Date
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
}

const NEON_PROJECTS = [
  {
    name: 'teko-prod',
    environment: 'production',
    projectVar: 'NEON_PROD_PROJECT_ID',
    keyVar: 'NEON_API_KEY_PROD',
  },
  {
    name: 'teko-staging',
    environment: 'staging',
    projectVar: 'NEON_STAGING_PROJECT_ID',
    keyVar: 'NEON_API_KEY_STAGING',
  },
] as const

/** `GET /projects/{id}` da API do Neon (console, nunca o compute: não acorda o banco). */
export async function fetchNeonUsage(
  projectId: string,
  apiKey: string,
  doFetch: typeof fetch,
): Promise<NeonProjectUsage> {
  if (!PROJECT_ID.test(projectId)) {
    throw new RangeError('ID de projeto inválido')
  }
  const response = await doFetch(new URL(`${NEON_API}/projects/${projectId}`), {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`API do Neon respondeu ${String(response.status)}`)
  }
  const body = (await response.json()) as { project?: Partial<NeonProjectUsage> }
  const project = body.project
  if (
    typeof project?.compute_time_seconds !== 'number' ||
    typeof project.consumption_period_start !== 'string' ||
    typeof project.data_transfer_bytes !== 'number'
  ) {
    throw new Error(
      'resposta do Neon sem compute_time_seconds, data_transfer_bytes ou consumption_period_start',
    )
  }
  return {
    compute_time_seconds: project.compute_time_seconds,
    data_transfer_bytes: project.data_transfer_bytes,
    consumption_period_start: project.consumption_period_start,
    consumption_period_end: project.consumption_period_end ?? null,
  }
}

const value = envValue

/** Coleta tudo o que estiver configurado; devolve os pontos e as falhas das fontes configuradas. */
export async function collect(
  deps: RunDeps,
): Promise<{ points: GaugePoint[]; failures: string[] }> {
  const points: GaugePoint[] = []
  const failures: string[] = []
  const warn = (message: string) => deps.log(`::warning title=ops-metrics::${message}`)
  const today = todayInSaoPaulo(deps.now)

  for (const project of NEON_PROJECTS) {
    const projectId = value(deps.env, project.projectVar)
    const apiKey = value(deps.env, project.keyVar)
    if (projectId === undefined && apiKey === undefined) {
      warn(`${project.name}: sem ${project.projectVar} e ${project.keyVar}, CU-h não medido`)
      continue
    }
    if (projectId === undefined || apiKey === undefined) {
      failures.push(
        `${project.name}: falta ${projectId === undefined ? project.projectVar : project.keyVar}`,
      )
      continue
    }
    try {
      const usage = await fetchNeonUsage(projectId, apiKey, deps.fetch)
      points.push(...neonUsagePoints(project, usage, deps.now))
    } catch (error) {
      failures.push(`${project.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const tokens = value(deps.env, 'TOKEN_EXPIRY_DATES')
  if (tokens === undefined) {
    warn('sem TOKEN_EXPIRY_DATES, expiração de tokens não medida')
  } else {
    try {
      points.push(...tokenExpiryPoints(tokens, today))
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }

  const coverage = value(deps.env, 'COVERAGE_AGE_JSON')
  if (coverage === undefined) {
    warn('sem o relatório do coverage-age (job pulado ou sem as URLs do teko_watch)')
  } else {
    try {
      const result = coverageAgePoints(coverage, today)
      points.push(...result.points)
      failures.push(...result.errors.map((error) => `coverage-age ${error}`))
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { points, failures }
}

/**
 * Coleta, imprime e envia. Código de saída: 0 ok (ou só avisos), 1 fonte ou envio falhou. Com
 * `successOnly`, não coleta nada e só registra o sucesso do job (ex.: `weekly-maintenance`, que roda
 * no environment `maintenance` e passa o resultado a um job seguinte no `ops`).
 */
export async function run(
  deps: RunDeps,
  options: { dryRun: boolean; job: string; successOnly?: boolean },
): Promise<{
  code: number
  summary: string[]
}> {
  const { points, failures } =
    options.successOnly === true ? { points: [], failures: [] } : await collect(deps)
  if (failures.length === 0) {
    points.push(jobSuccessPoint(options.job, deps.now))
  }
  for (const failure of failures) {
    deps.log(`::error title=ops-metrics::${failure}`)
  }
  const published = await publishPoints(points, deps, {
    dryRun: options.dryRun,
    serviceName: SERVICE_NAME,
    title: 'ops-metrics',
  })
  const summary = [`### ops-metrics (${options.job})`, '', ...published.summary]
  return { code: failures.length === 0 && published.ok ? 0 : 1, summary }
}

const JOB_NAME = /^[a-z][a-z0-9-]{0,39}$/u

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      job: { type: 'string', default: 'quotas' },
      'success-only': { type: 'boolean', default: false },
    },
    strict: true,
  })
  // O nome do job vai para o log, o resumo e o label: só um identificador curto passa.
  const job = values.job
  if (!JOB_NAME.test(job)) {
    throw new RangeError('--job precisa ser um nome curto em minúsculas (ex.: quotas)')
  }
  const { code, summary } = await run(
    { env: process.env, now: new Date(), fetch, log: logLine },
    { dryRun: values['dry-run'], job, successOnly: values['success-only'] },
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
