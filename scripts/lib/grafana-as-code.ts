/**
 * Grafana as code do Tekó (`infra/grafana/`): leitura, validação offline e expansão do formato
 * compacto para os modelos da API HTTP do Grafana (dashboards e regras de alerta) e do Synthetic
 * Monitoring (checks). Sem rede: quem fala com o Grafana é `scripts/grafana-apply.ts`.
 *
 * O formato compacto existe para o diff ser revisável: um painel é título, tipo, unidade e
 * consultas; uma regra é a consulta PromQL, o limiar e o runbook. O `gridPos`, o datasource, as
 * expressões `threshold` e o `notification_settings` saem daqui, sempre iguais.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareCodeUnits } from './cli-guards.ts'

// --- Formato compacto ------------------------------------------------------------------------

export interface StackSpec {
  readonly folder: { readonly uid: string; readonly title: string }
  readonly contactPoint: { readonly uid: string; readonly name: string }
  /** Base dos links de runbook (`.../blob/main/docs/runbooks/`). */
  readonly runbookBaseUrl: string
  /** UID do datasource Prometheus da stack quando `GRAFANA_PROM_DATASOURCE_UID` não vem. */
  readonly defaultPrometheusUid: string
}

interface VariableSpec {
  readonly name: string
  readonly label: string
  /** `label_values(<métrica>, <label>)`. */
  readonly query: string
}

interface TargetSpec {
  readonly expr: string
  readonly legend?: string
}

type PanelType = 'timeseries' | 'stat' | 'bargauge' | 'heatmap' | 'table' | 'text'

interface PanelSpec {
  readonly title: string
  readonly type: PanelType
  readonly description?: string
  readonly unit?: string
  /** Colunas na grade de 24 (padrão 12). */
  readonly w?: number
  /** Altura (padrão 8). */
  readonly h?: number
  readonly targets?: readonly TargetSpec[]
  /** Limiares em ordem crescente: verde abaixo do primeiro, amarelo, vermelho. */
  readonly thresholds?: readonly number[]
  readonly min?: number
  readonly max?: number
  /** Markdown do painel `text`. */
  readonly content?: string
}

export interface DashboardSpec {
  readonly uid: string
  readonly title: string
  readonly description: string
  readonly tags: readonly string[]
  readonly variables: readonly VariableSpec[]
  readonly panels: readonly PanelSpec[]
}

/** De onde vem a métrica da regra: só `api`, `ops` e `synthetic` existem na F6. */
type AlertSource = 'api' | 'ops' | 'synthetic' | 'langfuse' | 'f7'

export interface AlertRuleSpec {
  readonly uid: string
  readonly title: string
  readonly group: string
  readonly expr: string
  readonly op: 'gt' | 'lt'
  readonly threshold: number
  readonly for: string
  readonly severity: 'warning' | 'critical'
  /** `arquivo.md` ou `arquivo.md#ancora`, relativo a `docs/runbooks/`. */
  readonly runbook: string
  readonly summary: string
  readonly description: string
  readonly source: AlertSource
  /** Janela da consulta, em segundos (padrão 600). */
  readonly rangeSeconds?: number
}

interface AlertsSpec {
  readonly groups: readonly { readonly name: string; readonly interval: string }[]
  readonly rules: readonly AlertRuleSpec[]
}

export interface CheckSpec {
  readonly job: string
  readonly target: string
  readonly frequency: number
  readonly timeout: number
  readonly probes: readonly string[]
  readonly enabled: boolean
  readonly basicMetricsOnly: boolean
  readonly alertSensitivity: string
  readonly labels: readonly { readonly name: string; readonly value: string }[]
  readonly settings: { readonly http: Readonly<Record<string, unknown>> }
}

interface ChecksSpec {
  readonly checks: readonly CheckSpec[]
}

export interface GrafanaAsCode {
  readonly stack: StackSpec
  readonly dashboards: readonly DashboardSpec[]
  readonly alerts: AlertsSpec
  readonly checks: ChecksSpec
}

// --- Contrato de métricas --------------------------------------------------------------------

/**
 * Métricas que painéis e regras podem citar: as da API (mudança `add-otel-telemetry`), as do
 * `ops.yml` desta mudança, as que chegam depois (Langfuse e F7) e as do Synthetic Monitoring. Um
 * nome fora daqui é erro de digitação até prova em contrário.
 */
export const KNOWN_METRICS: ReadonlySet<string> = new Set([
  // API (OTel → Mimir)
  'http_server_request_duration_seconds_bucket',
  'http_server_request_duration_seconds_sum',
  'http_server_request_duration_seconds_count',
  'teko_rag_answers_total',
  'teko_rag_citations_invalidated_total',
  'teko_rag_insufficient_sentinel_total',
  'teko_rag_reranker_score_bucket',
  'teko_rag_reranker_score_sum',
  'teko_rag_reranker_score_count',
  'teko_llm_ttft_seconds_bucket',
  'teko_llm_ttft_seconds_sum',
  'teko_llm_ttft_seconds_count',
  'teko_llm_tokens_total',
  'teko_llm_shadow_cost_usd_total',
  'teko_llm_provider_errors_total',
  'teko_llm_provider_fallback_total',
  'teko_quota_used_ratio',
  // ops.yml (F6, scripts/ops-metrics.ts)
  'teko_neon_compute_hours',
  'teko_neon_cu_hours_ratio',
  'teko_coverage_verified_age_days',
  'teko_token_expiry_days',
  'teko_ops_job_last_success_timestamp_seconds',
  // Langfuse (mudança add-llm-tracing-langfuse) e F7 (vercel-usage, prod-vuln-scan)
  'teko_langfuse_units_projected',
  'teko_vercel_usage_ratio',
  'teko_prod_vuln_findings',
  // Synthetic Monitoring
  'probe_success',
  'probe_duration_seconds',
  'probe_http_status_code',
])

/**
 * Alertas da seção "Alertas por e-mail" de `docs/architecture/observabilidade.md`, um a um. A
 * validação exige exatamente este conjunto: alerta novo ou removido muda a arquitetura primeiro.
 */
export const REQUIRED_ALERTS: Readonly<Record<string, string>> = {
  'teko-api-5xx': '5xx > 2% em 10 min',
  'teko-api-questions-p95': 'p95 de POST /api/v1/questions > 3 s',
  'teko-llm-ttft-p95': 'TTFT p95 > 3 s',
  'teko-llm-429': '429 por provedor > 20% em 15 min',
  'teko-quota-used': 'teko_quota_used_ratio > 0,7',
  'teko-neon-cu-hours': 'CU-h > 70% pró-rata',
  'teko-langfuse-units': 'Langfuse projetado > 35k',
  'teko-vercel-usage-50': 'teko_vercel_usage_ratio > 0,5',
  'teko-vercel-usage-75': 'teko_vercel_usage_ratio > 0,75',
  'teko-deployment-paused':
    '503 DEPLOYMENT_PAUSED ou 402 DEPLOYMENT_DISABLED visto pelo Synthetic Monitoring',
  'teko-coverage-stale': 'teko_coverage_verified_age_days > 3',
  'teko-prod-vuln-scan': 'achado do prod-vuln-scan',
  'teko-token-expiry': 'tokens da Vercel vencendo em até 30 dias',
  'teko-ops-job-stale': 'falha do weekly-maintenance ou do vercel-usage',
  'teko-rag-refusal-anomaly': 'taxa de recusa fora do normal',
  'teko-rag-lexical-only': 'taxa de lexical_only fora do normal',
  'teko-synthetic-failed': 'check do Synthetic Monitoring falhando em todas as execuções de 20 min',
}

/** Teto de execuções mensais dos checks: metade das 100 mil do Grafana Cloud Free. */
export const SM_MONTHLY_EXECUTION_BUDGET = 50_000
/** Minutos num mês de 30 dias (fórmula de cobrança do Synthetic Monitoring). */
const MINUTES_PER_MONTH = 43_200

const UID = /^teko-[a-z0-9-]{1,35}$/u
const DURATION = /^\d+[smh]$/u
const BUILTIN_VARIABLES = new Set(['__rate_interval', '__interval', '__range', 'datasource'])
const EMAIL_LOCAL_CHAR = /[\w%+.-]/u
const EMAIL_DOMAIN_CHAR = /[\w.-]/u

/**
 * Há um e-mail em `text` (um caractere de usuário, `@` e um domínio com ao menos dois rótulos)?
 * Varre a partir de cada `@`, em tempo linear: uma regex do tipo `[\w%+.-]+@...` sem âncora é
 * tentada em cada posição do texto e fica quadrática num texto longo sem `@` (Sonar S8786).
 */
export function containsEmail(text: string): boolean {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    if (at === 0 || !EMAIL_LOCAL_CHAR.test(text.charAt(at - 1))) continue
    let end = at + 1
    while (end < text.length && EMAIL_DOMAIN_CHAR.test(text.charAt(end))) end += 1
    // Rótulos não vazios do começo do domínio, até o primeiro vazio (`a@b.c..` ainda vale por `b.c`).
    let labels = 0
    for (const label of text.slice(at + 1, end).split('.')) {
      if (label === '') break
      labels += 1
    }
    if (labels >= 2) return true
  }
  return false
}

// --- Leitura ---------------------------------------------------------------------------------

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

/** Lê `infra/grafana/` (stack, dashboards, alertas e checks), em ordem de nome de arquivo. */
export function loadGrafanaAsCode(dir: string): GrafanaAsCode {
  const dashboardsDir = join(dir, 'dashboards')
  const dashboards = readdirSync(dashboardsDir)
    .filter((name) => name.endsWith('.json'))
    .sort(compareCodeUnits)
    .map((name) => readJson<DashboardSpec>(join(dashboardsDir, name)))
  return {
    stack: readJson<StackSpec>(join(dir, 'stack.json')),
    dashboards,
    alerts: readJson<AlertsSpec>(join(dir, 'alerts.json')),
    checks: readJson<ChecksSpec>(join(dir, 'synthetic-monitoring.json')),
  }
}

/** Todos os textos dos JSON de `infra/grafana/`, para a checagem de e-mail. */
export function rawFiles(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const file = join(entry.parentPath, entry.name)
      out.push({ file, text: readFileSync(file, 'utf8') })
    }
  }
  return out
}

/** Runbook aceito num link → âncoras `<a id="...">` do arquivo (`null`: previsto, ainda sem arquivo). */
export type RunbookIndex = ReadonlyMap<string, ReadonlySet<string> | null>

/**
 * Runbooks aceitos nos links: os que existem em `docs/runbooks/` (com as âncoras explícitas, que
 * não dependem de como o GitHub gera o slug de títulos com acento) e os previstos (F7) na tabela
 * "Runbooks" de `docs/architecture/observabilidade.md`.
 */
export function knownRunbooks(repoRoot: string): RunbookIndex {
  const runbooks = new Map<string, ReadonlySet<string> | null>()
  const dir = join(repoRoot, 'docs', 'runbooks')
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.md'))) {
    const text = readFileSync(join(dir, name), 'utf8')
    runbooks.set(
      name,
      new Set([...text.matchAll(/<a id="([a-z0-9-]+)"><\/a>/gu)].map((m) => m[1] ?? '')),
    )
  }
  const architecture = join(repoRoot, 'docs', 'architecture', 'observabilidade.md')
  if (existsSync(architecture)) {
    for (const match of readFileSync(architecture, 'utf8').matchAll(/^\| `([a-z0-9-]+\.md)`/gmu)) {
      if (match[1] !== undefined && !runbooks.has(match[1])) runbooks.set(match[1], null)
    }
  }
  return runbooks
}

// --- Validação -------------------------------------------------------------------------------

/** Remove strings entre aspas (valores de label) para procurar nomes de métrica. */
function withoutQuoted(expr: string): string {
  return expr.replaceAll(/"(?:[^"\\]|\\.)*"/gu, '""')
}

export function metricsOf(expr: string): string[] {
  const names = withoutQuoted(expr).match(/\b(?:teko|http_server|probe)_[a-z0-9_]+\b/gu) ?? []
  return [...new Set(names)]
}

function balanced(expr: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  const stack: string[] = []
  for (const char of withoutQuoted(expr)) {
    if (char === '(' || char === '[' || char === '{') stack.push(char)
    else if (char in pairs && stack.pop() !== pairs[char]) return false
  }
  return stack.length === 0 && (expr.match(/"/gu)?.length ?? 0) % 2 === 0
}

function checkExpr(where: string, expr: string, variables: ReadonlySet<string>): string[] {
  const errors: string[] = []
  if (expr.trim() === '') return [`${where}: consulta vazia`]
  if (!balanced(expr)) errors.push(`${where}: parênteses, colchetes ou aspas desbalanceados`)
  for (const metric of metricsOf(expr)) {
    if (!KNOWN_METRICS.has(metric)) errors.push(`${where}: métrica fora do contrato: ${metric}`)
  }
  for (const match of expr.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)/gu)) {
    const name = match[1] ?? ''
    if (!variables.has(name) && !BUILTIN_VARIABLES.has(name)) {
      errors.push(`${where}: variável $${name} não declarada`)
    }
  }
  return errors
}

/**
 * Execuções por mês de um check. O Synthetic Monitoring cobra cada execução feita, por sonda; check
 * desligado (`enabled: false`) não roda e conta 0.
 */
export function monthlyExecutions(
  check: Pick<CheckSpec, 'frequency' | 'probes' | 'enabled'>,
): number {
  if (!check.enabled) return 0
  return Math.round((check.probes.length * MINUTES_PER_MONTH) / (check.frequency / 60_000))
}

function validateDashboards(dashboards: readonly DashboardSpec[]): string[] {
  const errors: string[] = []
  for (const dashboard of dashboards) {
    const where = `dashboard ${dashboard.uid}`
    if (!dashboard.title || !dashboard.description) errors.push(`${where}: sem título ou descrição`)
    const variables = new Set(dashboard.variables.map((variable) => variable.name))
    for (const variable of dashboard.variables) {
      if (!/^label_values\(.+,\s*[a-z_]+\)$/u.test(variable.query)) {
        errors.push(
          `${where}: variável ${variable.name} precisa ser label_values(<métrica>, <label>)`,
        )
      }
      errors.push(...checkExpr(`${where} variável ${variable.name}`, variable.query, variables))
    }
    if (dashboard.panels.length === 0) errors.push(`${where}: sem painéis`)
    for (const panel of dashboard.panels) {
      const panelWhere = `${where} painel "${panel.title}"`
      if ((panel.w ?? 12) < 1 || (panel.w ?? 12) > 24) errors.push(`${panelWhere}: w fora de 1..24`)
      if (panel.type === 'text') {
        if (!panel.content) errors.push(`${panelWhere}: painel text sem content`)
        continue
      }
      if (!panel.targets || panel.targets.length === 0) errors.push(`${panelWhere}: sem consultas`)
      for (const target of panel.targets ?? []) {
        errors.push(...checkExpr(panelWhere, target.expr, variables))
      }
      const thresholds = panel.thresholds ?? []
      if (thresholds.some((value, index) => index > 0 && value <= (thresholds[index - 1] ?? 0))) {
        errors.push(`${panelWhere}: limiares fora de ordem`)
      }
    }
  }
  return errors
}

function validateAlerts(alerts: AlertsSpec, runbooks: RunbookIndex): string[] {
  const errors: string[] = []
  const groups = new Set(alerts.groups.map((group) => group.name))
  for (const group of alerts.groups) {
    if (!DURATION.test(group.interval)) errors.push(`grupo ${group.name}: interval inválido`)
  }
  const uids = alerts.rules.map((rule) => rule.uid)
  const required = Object.keys(REQUIRED_ALERTS)
  for (const uid of required.filter((name) => !uids.includes(name))) {
    errors.push(`alerta obrigatório ausente: ${uid} (${REQUIRED_ALERTS[uid] ?? ''})`)
  }
  for (const uid of uids.filter((name) => !required.includes(name))) {
    errors.push(`alerta fora da seção "Alertas por e-mail" da arquitetura: ${uid}`)
  }
  for (const rule of alerts.rules) {
    const where = `alerta ${rule.uid}`
    if (!groups.has(rule.group)) errors.push(`${where}: grupo ${rule.group} não declarado`)
    if (!DURATION.test(rule.for)) errors.push(`${where}: for inválido`)
    if (!Number.isFinite(rule.threshold)) errors.push(`${where}: limiar inválido`)
    if (!rule.summary || !rule.description) errors.push(`${where}: sem summary ou description`)
    const runbook = /^([a-z0-9-]+\.md)(?:#([a-z0-9-]+))?$/u.exec(rule.runbook ?? '')
    const file = runbook?.[1] ?? ''
    const anchor = runbook?.[2]
    const anchors = runbooks.get(file)
    if (runbook === null) {
      errors.push(`${where}: runbook precisa ser <arquivo>.md[#ancora] de docs/runbooks/`)
    } else if (anchors === undefined) {
      errors.push(`${where}: runbook ${file} não existe nem está previsto na arquitetura`)
    } else if (anchor !== undefined && anchors !== null && !anchors.has(anchor)) {
      errors.push(`${where}: ${file} sem a âncora <a id="${anchor}"></a>`)
    }
    errors.push(...checkExpr(where, rule.expr, new Set()))
  }
  return errors
}

function validateChecks(checks: ChecksSpec): string[] {
  const errors: string[] = []
  let total = 0
  for (const check of checks.checks) {
    const where = `check ${check.job}`
    if (!UID.test(check.job)) errors.push(`${where}: job precisa começar com teko-`)
    if (!check.target.startsWith('https://')) errors.push(`${where}: alvo sem https`)
    if (check.frequency < 10_000 || check.frequency > 3_600_000) {
      errors.push(`${where}: frequência fora de 10 s..1 h`)
    }
    if (check.timeout < 1000 || check.timeout > 60_000 || check.timeout >= check.frequency) {
      errors.push(`${where}: timeout fora de 1..60 s ou maior que a frequência`)
    }
    if (check.probes.length === 0) errors.push(`${where}: sem sondas`)
    if (typeof check.enabled !== 'boolean')
      errors.push(`${where}: enabled precisa ser true ou false`)
    total += monthlyExecutions(check)
  }
  if (total > SM_MONTHLY_EXECUTION_BUDGET) {
    errors.push(
      `checks: ${String(total)} execuções/mês passam do teto de ${String(SM_MONTHLY_EXECUTION_BUDGET)} ` +
        '(50% do Free)',
    )
  }
  return errors
}

/** Erros de validação (vazio = ok). `runbooks`: nomes aceitos em `runbook` (ver `knownRunbooks`). */
export function validate(
  code: GrafanaAsCode,
  runbooks: RunbookIndex,
  files: readonly { file: string; text: string }[] = [],
): string[] {
  const errors: string[] = []
  const uids = [
    code.stack.folder.uid,
    code.stack.contactPoint.uid,
    ...code.dashboards.map((dashboard) => dashboard.uid),
    ...code.alerts.rules.map((rule) => rule.uid),
  ]
  const seen = new Set<string>()
  for (const uid of uids) {
    if (!UID.test(uid)) errors.push(`uid inválido: ${uid} (teko-..., até 40 caracteres)`)
    if (seen.has(uid)) errors.push(`uid repetido: ${uid}`)
    seen.add(uid)
  }
  if (!code.stack.runbookBaseUrl.startsWith('https://github.com/')) {
    errors.push('stack.json: runbookBaseUrl precisa apontar para o GitHub')
  }
  errors.push(...validateDashboards(code.dashboards))
  errors.push(...validateAlerts(code.alerts, runbooks))
  errors.push(...validateChecks(code.checks))
  for (const { file, text } of files) {
    if (containsEmail(text))
      errors.push(`${file}: e-mail no repositório (use GRAFANA_ALERT_EMAILS)`)
  }
  return errors
}

// --- Expansão --------------------------------------------------------------------------------

const DATASOURCE = { type: 'prometheus', uid: '$datasource' } as const

function thresholdSteps(thresholds: readonly number[] | undefined): unknown[] {
  const colors = ['green', 'yellow', 'red']
  const values = thresholds ?? []
  return [
    { color: colors[0], value: null },
    ...values.map((value, index) => ({
      color: colors[Math.min(index + 1, colors.length - 1)],
      value,
    })),
  ]
}

function expandPanel(panel: PanelSpec, id: number, x: number, y: number): unknown {
  const w = panel.w ?? 12
  const h = panel.h ?? 8
  const base = {
    id,
    title: panel.title,
    type: panel.type,
    ...(panel.description === undefined ? {} : { description: panel.description }),
    gridPos: { x, y, w, h },
  }
  if (panel.type === 'text') {
    return { ...base, options: { mode: 'markdown', content: panel.content ?? '' } }
  }
  return {
    ...base,
    datasource: DATASOURCE,
    targets: (panel.targets ?? []).map((target, index) => ({
      refId: String.fromCodePoint(65 + index),
      datasource: DATASOURCE,
      expr: target.expr,
      legendFormat: target.legend ?? '__auto',
      range: panel.type !== 'stat' && panel.type !== 'bargauge' && panel.type !== 'table',
      instant: panel.type === 'stat' || panel.type === 'bargauge' || panel.type === 'table',
      ...(panel.type === 'heatmap' ? { format: 'heatmap' } : {}),
    })),
    fieldConfig: {
      defaults: {
        ...(panel.unit === undefined ? {} : { unit: panel.unit }),
        ...(panel.min === undefined ? {} : { min: panel.min }),
        ...(panel.max === undefined ? {} : { max: panel.max }),
        thresholds: { mode: 'absolute', steps: thresholdSteps(panel.thresholds) },
        ...(panel.type === 'timeseries' && panel.thresholds !== undefined
          ? { custom: { thresholdsStyle: { mode: 'line' } } }
          : {}),
      },
      overrides: [],
    },
    options:
      panel.type === 'timeseries'
        ? { legend: { displayMode: 'table', placement: 'bottom', calcs: ['lastNotNull', 'max'] } }
        : panel.type === 'heatmap'
          ? { calculate: false, yAxis: { unit: panel.unit ?? 'short' } }
          : { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false } },
  }
}

/** Modelo de dashboard da API (`POST /api/dashboards/db`), com a grade montada em ordem. */
export function expandDashboard(spec: DashboardSpec): Record<string, unknown> {
  let x = 0
  let y = 0
  let rowHeight = 0
  const panels = spec.panels.map((panel, index) => {
    const w = panel.w ?? 12
    if (x + w > 24) {
      x = 0
      y += rowHeight
      rowHeight = 0
    }
    const expanded = expandPanel(panel, index + 1, x, y)
    x += w
    rowHeight = Math.max(rowHeight, panel.h ?? 8)
    return expanded
  })
  return {
    uid: spec.uid,
    title: spec.title,
    description: spec.description,
    tags: [...spec.tags],
    timezone: 'browser',
    editable: false,
    graphTooltip: 1,
    schemaVersion: 41,
    time: { from: 'now-24h', to: 'now' },
    refresh: '5m',
    templating: {
      list: [
        {
          name: 'datasource',
          label: 'Fonte',
          type: 'datasource',
          query: 'prometheus',
          current: {},
          hide: 0,
        },
        ...spec.variables.map((variable) => ({
          name: variable.name,
          label: variable.label,
          type: 'query',
          datasource: DATASOURCE,
          query: { query: variable.query, refId: 'variable' },
          definition: variable.query,
          refresh: 2,
          multi: true,
          includeAll: true,
          allValue: '.*',
          current: { text: 'All', value: '$__all' },
          sort: 1,
        })),
      ],
    },
    panels,
  }
}

function seconds(duration: string): number {
  const match = /^(\d+)([smh])$/u.exec(duration)
  if (match === null) throw new RangeError(`duração inválida: ${duration}`)
  const factor = { s: 1, m: 60, h: 3600 }[match[2] as 's' | 'm' | 'h']
  return Number(match[1]) * factor
}

/**
 * Corpo do `PUT /api/v1/provisioning/folder/{folderUid}/rule-groups/{group}`: cada regra é a
 * consulta `A` (instantânea) e o `threshold` `B`, notificando o contact point da stack.
 */
export function expandRuleGroup(
  code: Pick<GrafanaAsCode, 'stack' | 'alerts'>,
  groupName: string,
  datasourceUid: string,
): Record<string, unknown> {
  const group = code.alerts.groups.find((item) => item.name === groupName)
  if (group === undefined) throw new RangeError(`grupo desconhecido: ${groupName}`)
  const { stack } = code
  return {
    title: group.name,
    folderUid: stack.folder.uid,
    interval: seconds(group.interval),
    rules: code.alerts.rules
      .filter((rule) => rule.group === group.name)
      .map((rule) => ({
        uid: rule.uid,
        title: rule.title,
        ruleGroup: group.name,
        folderUID: stack.folder.uid,
        orgID: 1,
        condition: 'B',
        for: rule.for,
        // Sem dado = sem tráfego ou fonte ainda inexistente (F7, Langfuse): não é alerta.
        noDataState: 'OK',
        execErrState: 'Error',
        isPaused: false,
        labels: { severity: rule.severity, source: rule.source, teko: 'true' },
        annotations: {
          summary: rule.summary,
          description: rule.description,
          runbook_url: `${stack.runbookBaseUrl}${rule.runbook}`,
        },
        notification_settings: { receiver: stack.contactPoint.name },
        data: [
          {
            refId: 'A',
            relativeTimeRange: { from: rule.rangeSeconds ?? 600, to: 0 },
            datasourceUid,
            model: {
              refId: 'A',
              expr: rule.expr,
              instant: true,
              range: false,
              datasource: { type: 'prometheus', uid: datasourceUid },
              intervalMs: 1000,
              maxDataPoints: 43_200,
            },
          },
          {
            refId: 'B',
            relativeTimeRange: { from: 0, to: 0 },
            datasourceUid: '__expr__',
            model: {
              refId: 'B',
              type: 'threshold',
              expression: 'A',
              datasource: { type: '__expr__', uid: '__expr__' },
              conditions: [{ evaluator: { type: rule.op, params: [rule.threshold] } }],
            },
          },
        ],
      })),
  }
}

/** Contact point de e-mail, com os endereços vindos do segredo (`;` ou `,` entre eles). */
export function expandContactPoint(stack: StackSpec, addresses: string): Record<string, unknown> {
  const list = addresses
    .split(/[;,\s]+/u)
    .map((item) => item.trim())
    .filter((item) => item !== '')
  if (list.length === 0 || list.some((item) => !containsEmail(item))) {
    throw new RangeError('GRAFANA_ALERT_EMAILS precisa ter um ou mais e-mails separados por ;')
  }
  return {
    uid: stack.contactPoint.uid,
    name: stack.contactPoint.name,
    type: 'email',
    settings: { addresses: list.join(';'), singleEmail: true },
    disableResolveMessage: false,
  }
}
