/**
 * Job `langfuse` do `.github/workflows/ops.yml` (F6, mudança add-llm-tracing-langfuse), uma vez
 * por dia, nos projetos `teko-prod` e `teko-staging` do Langfuse Cloud (EU):
 *
 * 1. **Modelos e preços** (Settings → Models): um modelo próprio por entrada de
 *    `apps/api/src/application/services/pricing.ts`, com o preço de tabela por token. Modelo com
 *    preço diferente é apagado e recriado; modelos gerenciados pelo Langfuse ficam como estão.
 * 2. **Feedback:** a score config `user_feedback` (BOOLEAN) e a annotation queue do 👎
 *    (`teko-feedback-negativo`), que a API usa (`adapters/out/telemetry/langfuse-api.ts`).
 * 3. **Units projetadas:** observations, traces (observations raiz) e scores do mês corrente (UTC)
 *    pela Metrics API v2 dos dois projetos, somados e projetados linearmente para o mês:
 *    `teko_langfuse_units_projected` (gauge sem labels; alerta acima de 35k) e o sucesso em
 *    `teko_ops_job_last_success_timestamp_seconds{ops_job="langfuse"}`.
 *
 * A projeção vem da API do Langfuse, e não de `app.usage_daily.langfuse_units`: a cota do Hobby é
 * da organização (os dois projetos somados), conta também o que a API não conta (scores de
 * avaliações manuais, traces de testes) e a leitura não acorda o compute do Neon nem precisa de
 * credencial de banco no environment `ops`. O `usage_daily` é a estimativa local que o
 * `TraceSampler` da API usa para cortar a amostragem sem sair do processo.
 *
 * Projeto sem chaves é pulado com aviso (o environment `ops` pode estar vazio); falha numa fonte
 * configurada deixa o job vermelho depois de enviar o resto. Sem a credencial OTLP, as métricas só
 * são impressas. Com `--dry-run`, nada é escrito no Langfuse nem enviado ao Grafana.
 *
 * Uso: node scripts/langfuse-ops.ts [--dry-run]
 */
import { appendFileSync } from 'node:fs'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  FEEDBACK_QUEUE_NAME,
  FEEDBACK_SCORE_NAME,
} from '../apps/api/src/adapters/out/telemetry/langfuse-names.ts'
import { MODEL_PRICES, PRICING_DATE } from '../apps/api/src/application/services/pricing.ts'
import { buildMetricsPayload, type GaugePoint, pushMetrics } from './lib/otlp-metrics.ts'
import { jobSuccessPoint } from './ops-metrics.ts'

const JOB = 'langfuse'
const SERVICE_NAME = 'teko-ops'
const DEFAULT_BASE_URL = 'https://cloud.langfuse.com'
const DAY_MS = 86_400_000
const REQUEST_TIMEOUT_MS = 20_000
const PAGE_LIMIT = 100

export interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: Date
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
}

/** Preço por token (USD) de cada tipo de uso: `input` e `output`, os do `usageDetails`. */
interface TokenPrices {
  readonly input: number
  readonly output: number
}

/** Modelo próprio no Langfuse: um tier padrão com o preço de tabela por token. */
export interface ModelDefinition {
  readonly modelName: string
  readonly matchPattern: string
  readonly unit: 'TOKENS'
  readonly startDate: string
  readonly pricingTiers: readonly [
    {
      readonly name: 'Standard'
      readonly isDefault: true
      readonly priority: 0
      readonly conditions: readonly []
      readonly prices: TokenPrices
    },
  ]
}

interface ExistingModel {
  readonly id: string
  readonly modelName: string
  readonly isLangfuseManaged?: boolean
  readonly matchPattern?: string
  readonly pricingTiers?: readonly {
    readonly isDefault?: boolean
    readonly prices?: Readonly<Record<string, number>>
  }[]
}

const REGEX_SPECIAL = new Set([...'\\^$.*+?()[]{}|/-'])

function escapeRegex(text: string): string {
  return [...text].map((char) => (REGEX_SPECIAL.has(char) ? `\\${char}` : char)).join('')
}

/** As definições que `pricing.ts` pede (preço por milhão → por token). */
export function desiredModels(): ModelDefinition[] {
  return MODEL_PRICES.map((price) => ({
    modelName: price.model,
    matchPattern: `(?i)^(${escapeRegex(price.model)})$`,
    unit: 'TOKENS',
    startDate: `${PRICING_DATE}T00:00:00.000Z`,
    pricingTiers: [
      {
        name: 'Standard',
        isDefault: true,
        priority: 0,
        conditions: [],
        prices: {
          input: price.inputPerMillion / 1_000_000,
          output: price.outputPerMillion / 1_000_000,
        },
      },
    ],
  }))
}

const samePrice = (a: number | undefined, b: number): boolean =>
  typeof a === 'number' && Math.abs(a - b) < 1e-15

/** O modelo existente já cobra o preço e casa o padrão de `model`. */
function matches(item: ExistingModel, model: ModelDefinition): boolean {
  const prices = item.pricingTiers?.find((tier) => tier.isDefault === true)?.prices ?? {}
  const wanted = model.pricingTiers[0].prices
  return (
    item.matchPattern === model.matchPattern &&
    samePrice(prices['input'], wanted.input) &&
    samePrice(prices['output'], wanted.output)
  )
}

/**
 * O que mudar: cria o que falta, apaga o modelo próprio com preço ou padrão diferente (e o recria).
 * Modelos gerenciados pelo Langfuse e modelos próprios fora da tabela não são tocados.
 */
export function planModels(
  existing: readonly ExistingModel[],
  desired: readonly ModelDefinition[],
): { readonly create: ModelDefinition[]; readonly remove: string[] } {
  const create: ModelDefinition[] = []
  const remove: string[] = []
  for (const model of desired) {
    const own = existing.filter(
      (item) => item.isLangfuseManaged !== true && item.modelName === model.modelName,
    )
    const current = own.find((item) => matches(item, model))
    remove.push(...own.filter((item) => item !== current).map((item) => item.id))
    if (current === undefined) {
      create.push(model)
    }
  }
  return { create, remove }
}

/** Início do mês corrente (UTC) e a projeção linear: `usado / dias decorridos × dias do mês`. */
export function projectMonthlyUnits(
  used: number,
  now: Date,
): { readonly from: Date; readonly projected: number } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const days = (next.getTime() - from.getTime()) / DAY_MS
  const elapsed = Math.max(1, (now.getTime() - from.getTime()) / DAY_MS)
  return { from, projected: (used / elapsed) * days }
}

interface Project {
  readonly name: string
  readonly publicKey: string
  readonly secretKey: string
}

type Api = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options?: { readonly body?: unknown; readonly query?: Readonly<Record<string, string>> },
) => Promise<unknown>

function apiFor(baseUrl: string, project: Project, doFetch: typeof fetch): Api {
  let origin = baseUrl
  while (origin.endsWith('/')) {
    origin = origin.slice(0, -1)
  }
  const authorization = `Basic ${Buffer.from(`${project.publicKey}:${project.secretKey}`).toString('base64')}`
  return async (method, path, options = {}) => {
    const url = new URL(`${origin}${path}`)
    for (const [key, val] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, val)
    }
    const response = await doFetch(url, {
      method,
      headers: {
        authorization,
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      // Só o status e o caminho: o corpo pode repetir dados do projeto.
      throw new Error(`${method} ${path} respondeu ${String(response.status)}`)
    }
    const text = await response.text()
    return text === '' ? null : (JSON.parse(text) as unknown)
  }
}

interface Page<T> {
  readonly data?: readonly T[]
  readonly meta?: { readonly totalPages?: number; readonly page?: number }
}

/** Todas as páginas de uma listagem paginada por `page`/`limit`. */
async function listAll<T>(api: Api, path: string): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= 50; page += 1) {
    const body = (await api('GET', path, {
      query: { page: String(page), limit: String(PAGE_LIMIT) },
    })) as Page<T> | null
    items.push(...(body?.data ?? []))
    if (page >= (body?.meta?.totalPages ?? 1)) {
      break
    }
  }
  return items
}

async function syncModels(api: Api, dryRun: boolean): Promise<string[]> {
  const existing = await listAll<ExistingModel>(api, '/api/public/models')
  const plan = planModels(existing, desiredModels())
  const lines = [
    ...plan.remove.map((id) => `apagar modelo ${id}`),
    ...plan.create.map((model) => `criar modelo ${model.modelName}`),
  ]
  if (!dryRun) {
    for (const id of plan.remove) {
      await api('DELETE', `/api/public/models/${encodeURIComponent(id)}`)
    }
    for (const model of plan.create) {
      await api('POST', '/api/public/models', { body: model })
    }
  }
  return lines
}

async function ensureFeedbackQueue(api: Api, dryRun: boolean): Promise<string[]> {
  const configs = await listAll<{ id: string; name: string; isArchived?: boolean }>(
    api,
    '/api/public/score-configs',
  )
  let config = configs.find((item) => item.name === FEEDBACK_SCORE_NAME && item.isArchived !== true)
  const lines: string[] = []
  if (config === undefined) {
    lines.push(`criar score config ${FEEDBACK_SCORE_NAME}`)
    if (!dryRun) {
      config = (await api('POST', '/api/public/score-configs', {
        body: {
          name: FEEDBACK_SCORE_NAME,
          dataType: 'BOOLEAN',
          description: 'Polegar do usuário no Tekó: 1 = útil, 0 = não útil (comentário: o motivo).',
        },
      })) as { id: string; name: string }
    }
  }
  const queues = await listAll<{ id: string; name: string }>(api, '/api/public/annotation-queues')
  if (!queues.some((queue) => queue.name === FEEDBACK_QUEUE_NAME)) {
    lines.push(`criar annotation queue ${FEEDBACK_QUEUE_NAME}`)
    if (!dryRun && config !== undefined) {
      await api('POST', '/api/public/annotation-queues', {
        body: {
          name: FEEDBACK_QUEUE_NAME,
          description:
            'Respostas com 👎 no Tekó: triagem mensal; os casos aprovados entram no golden holdout (ADR 0031).',
          scoreConfigIds: [config.id],
        },
      })
    }
  }
  return lines
}

type MetricsRow = Readonly<Record<string, unknown>>

async function countOf(
  api: Api,
  view: string,
  from: Date,
  to: Date,
  filters: readonly unknown[] = [],
): Promise<number> {
  const body = (await api('GET', '/api/public/v2/metrics', {
    query: {
      query: JSON.stringify({
        view,
        metrics: [{ measure: 'count', aggregation: 'count' }],
        dimensions: [],
        filters,
        fromTimestamp: from.toISOString(),
        toTimestamp: to.toISOString(),
      }),
    },
  })) as { data?: readonly MetricsRow[] } | null
  const value = body?.data?.[0]?.['count_count']
  const count = typeof value === 'string' ? Number(value) : value
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    // Sem linha (nada no período), a contagem é 0.
    if ((body?.data ?? []).length === 0) {
      return 0
    }
    throw new Error(`Metrics API sem count_count na view ${view}`)
  }
  return count
}

/** Units do mês no projeto: observations + traces (raízes) + scores. */
export async function monthUnits(api: Api, from: Date, to: Date): Promise<number> {
  const root = [{ column: 'isRootObservation', operator: '=', value: true, type: 'boolean' }]
  const counts = await Promise.all([
    countOf(api, 'observations', from, to),
    countOf(api, 'observations', from, to, root),
    countOf(api, 'scores-numeric', from, to),
    countOf(api, 'scores-categorical', from, to),
    countOf(api, 'scores-boolean', from, to),
  ])
  return counts.reduce((sum, count) => sum + count, 0)
}

/** As chaves vão em Basic auth: https, ou http só no Langfuse local (profile `langfuse`). */
export function isAllowedBaseUrl(raw: string): boolean {
  if (!URL.canParse(raw)) {
    return false
  }
  const url = new URL(raw)
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  )
}

function value(env: RunDeps['env'], name: string): string | undefined {
  const raw = env[name]?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

const PROJECTS = [
  {
    name: 'teko-prod',
    publicVar: 'LANGFUSE_PROD_PUBLIC_KEY',
    secretVar: 'LANGFUSE_PROD_SECRET_KEY',
  },
  {
    name: 'teko-staging',
    publicVar: 'LANGFUSE_STAGING_PUBLIC_KEY',
    secretVar: 'LANGFUSE_STAGING_SECRET_KEY',
  },
] as const

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

interface ProjectResult {
  readonly lines: string[]
  readonly failures: string[]
  /** `null` quando o projeto foi pulado ou a medição falhou. */
  readonly units: number | null
}

/** Modelos, feedback e units de um projeto; nada lança: as falhas voltam no resultado. */
async function processProject(
  api: Api,
  name: string,
  options: { readonly dryRun: boolean; readonly from: Date; readonly to: Date },
): Promise<ProjectResult> {
  const lines: string[] = []
  const failures: string[] = []
  try {
    const changes = [
      ...(await syncModels(api, options.dryRun)),
      ...(await ensureFeedbackQueue(api, options.dryRun)),
    ]
    const suffix = options.dryRun && changes.length > 0 ? ' (dry-run)' : ''
    lines.push(
      `- ${name}: ${changes.length === 0 ? 'modelos e feedback em dia' : changes.join('; ')}${suffix}`,
    )
  } catch (error) {
    failures.push(`${name}: ${messageOf(error)}`)
  }
  let units: number | null = null
  try {
    units = await monthUnits(api, options.from, options.to)
    lines.push(`- ${name}: ${String(units)} units no mês`)
  } catch (error) {
    failures.push(`${name} (units): ${messageOf(error)}`)
  }
  return { lines, failures, units }
}

/** Envia os pontos ao Grafana Cloud (ou só imprime); `false` se o envio falhou. */
async function sendPoints(
  deps: RunDeps,
  points: readonly GaugePoint[],
  dryRun: boolean,
  summary: string[],
): Promise<boolean> {
  const payload = buildMetricsPayload(points, { serviceName: SERVICE_NAME, now: deps.now })
  const endpoint = value(deps.env, 'GRAFANA_OTLP_ENDPOINT')
  const instanceId = value(deps.env, 'GRAFANA_OTLP_INSTANCE_ID')
  const token = value(deps.env, 'GRAFANA_OTLP_TOKEN')
  if (points.length === 0) {
    summary.push('', 'Nenhuma métrica a enviar.')
    return true
  }
  if (dryRun) {
    deps.log(JSON.stringify(payload))
    summary.push('', 'Dry-run: nada foi escrito nem enviado.')
    return true
  }
  if (endpoint === undefined || instanceId === undefined || token === undefined) {
    deps.log(
      '::warning title=langfuse-ops::sem GRAFANA_OTLP_ENDPOINT, GRAFANA_OTLP_INSTANCE_ID ou GRAFANA_OTLP_TOKEN: métricas não enviadas',
    )
    summary.push('', 'Sem credencial OTLP: nada foi enviado.')
    return true
  }
  try {
    await pushMetrics({ endpoint, instanceId, token }, payload, deps.fetch)
    summary.push('', `${String(points.length)} ponto(s) enviados ao Grafana Cloud.`)
    return true
  } catch (error) {
    deps.log(`::error title=langfuse-ops::${messageOf(error)}`)
    return false
  }
}

/** Aplica modelos e feedback e mede as units; código 0 ok (ou só avisos), 1 se algo falhou. */
export async function run(
  deps: RunDeps,
  options: { readonly dryRun: boolean },
): Promise<{ code: number; summary: string[] }> {
  const baseUrl = value(deps.env, 'LANGFUSE_BASE_URL') ?? DEFAULT_BASE_URL
  if (!isAllowedBaseUrl(baseUrl)) {
    deps.log(
      '::error title=langfuse-ops::LANGFUSE_BASE_URL precisa ser https (http só em localhost)',
    )
    return { code: 1, summary: ['### langfuse-ops', '', 'LANGFUSE_BASE_URL sem https.'] }
  }
  const summary = ['### langfuse-ops', '']
  const failures: string[] = []
  const { from } = projectMonthlyUnits(0, deps.now)
  const measured: number[] = []
  for (const project of PROJECTS) {
    const publicKey = value(deps.env, project.publicVar)
    const secretKey = value(deps.env, project.secretVar)
    if (publicKey === undefined || secretKey === undefined) {
      deps.log(
        `::warning title=langfuse-ops::${project.name}: sem ${project.publicVar} e ${project.secretVar} no environment ops, projeto pulado`,
      )
      summary.push(`- ${project.name}: sem chaves, pulado.`)
      continue
    }
    const api = apiFor(baseUrl, { name: project.name, publicKey, secretKey }, deps.fetch)
    const result = await processProject(api, project.name, {
      dryRun: options.dryRun,
      from,
      to: deps.now,
    })
    summary.push(...result.lines)
    failures.push(...result.failures)
    if (result.units !== null) {
      measured.push(result.units)
    }
  }

  const points: GaugePoint[] = []
  if (measured.length > 0) {
    const used = measured.reduce((sum, units) => sum + units, 0)
    points.push({
      name: 'teko_langfuse_units_projected',
      value: Math.round(projectMonthlyUnits(used, deps.now).projected),
      description: 'Units do Langfuse projetadas no mês (os dois projetos somados)',
    })
    if (failures.length === 0) {
      points.push(jobSuccessPoint(JOB, deps.now))
    }
  }
  for (const failure of failures) {
    deps.log(`::error title=langfuse-ops::${failure}`)
  }
  summary.push('', ...points.map((point) => `| ${point.name} | ${String(point.value)} |`))
  const sent = await sendPoints(deps, points, options.dryRun, summary)
  return { code: sent && failures.length === 0 ? 0 : 1, summary }
}

/** Uma linha por chamada: quebra de linha vinda de erro ou resposta não forja comando do Actions. */
function logLine(line: string): void {
  console.log(line.replaceAll(/[\r\n]/gu, ' '))
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean', default: false } },
    strict: true,
  })
  const { code, summary } = await run(
    { env: process.env, now: new Date(), fetch, log: logLine },
    { dryRun: values['dry-run'] },
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
