/**
 * Aplica o Grafana as code de `infra/grafana/` (F6, mudança `add-uptime-monitoring`) pela API HTTP
 * do Grafana e do Synthetic Monitoring, sem CLI de terceiros e sem estado guardado: cada recurso
 * tem UID ou `job` fixo e é criado ou sobrescrito.
 *
 * Modos:
 *   --validate   só a validação offline (sem rede nem credencial); roda no CI pelos testes
 *   --dry-run    valida, lê o estado real (só GET) e imprime o plano, sem escrever
 *   (padrão)     valida e aplica: pasta, contact point, dashboards, grupos de regras e checks
 *
 * Ambiente (environment `ops` do GitHub; ver infra/grafana/README.md):
 *   GRAFANA_URL                  URL da stack (https://<stack>.grafana.net)
 *   GRAFANA_SA_TOKEN             token do service account (Editor, ou Admin para alertas)
 *   GRAFANA_SM_URL               API do Synthetic Monitoring da região da stack
 *   GRAFANA_SM_TOKEN             access token do Synthetic Monitoring
 *   GRAFANA_ALERT_EMAILS         e-mails do contact point, separados por ;
 *   GRAFANA_PROM_DATASOURCE_UID  opcional; padrão do stack.json (grafanacloud-prom)
 *
 * O que fica de fora não é apagado, exceto checks com `job` começando por `teko-` que saíram do
 * arquivo (contam execuções da cota). Uso: node scripts/grafana-apply.ts [--validate|--dry-run]
 */
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import {
  type CheckSpec,
  expandContactPoint,
  expandDashboard,
  expandRuleGroup,
  type GrafanaAsCode,
  knownRunbooks,
  loadGrafanaAsCode,
  monthlyExecutions,
  rawFiles,
  validate,
} from './lib/grafana-as-code.ts'

const REPO_ROOT = join(import.meta.dirname, '..')
export const GRAFANA_DIR = join(REPO_ROOT, 'infra', 'grafana')

export type Mode = 'dry-run' | 'apply'

export interface PlanItem {
  readonly kind: 'folder' | 'contact-point' | 'dashboard' | 'rule-group' | 'check'
  readonly id: string
  readonly action: 'create' | 'update' | 'delete' | 'keep' | 'skip'
  readonly note?: string
}

export interface ApplyEnv {
  readonly grafanaUrl: string
  readonly saToken: string
  readonly smUrl?: string | undefined
  readonly smToken?: string | undefined
  readonly alertEmails?: string | undefined
  readonly promDatasourceUid?: string | undefined
}

/** Só hosts `*.grafana.net` por https: o token nunca vai para outro lugar. */
export function grafanaBase(raw: string, name: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new RangeError(`${name} não é uma URL`)
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.grafana.net')) {
    throw new RangeError(`${name} precisa ser https://<algo>.grafana.net`)
  }
  return url.origin
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

interface Client {
  get(path: string): Promise<unknown>
  /** GET que devolve `null` em 404. */
  find(path: string): Promise<unknown>
  send(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown>
}

function client(base: string, token: string, doFetch: typeof fetch): Client {
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await doFetch(new URL(path, base), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new HttpError(
        response.status,
        `${method} ${path} respondeu ${String(response.status)}: ${text.slice(0, 300)}`,
      )
    }
    return text === '' ? null : (JSON.parse(text) as unknown)
  }
  return {
    get: (path) => request('GET', path),
    find: async (path) => {
      try {
        return await request('GET', path)
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return null
        throw error
      }
    },
    send: (method, path, body) => request(method, path, body),
  }
}

interface ApplyContext {
  readonly code: GrafanaAsCode
  readonly mode: Mode
  readonly plan: PlanItem[]
  readonly log: (line: string) => void
}

const warn = (context: ApplyContext, message: string) =>
  context.log(`::warning title=grafana-apply::${message}`)

async function applyFolder(context: ApplyContext, grafana: Client): Promise<void> {
  const { uid, title } = context.code.stack.folder
  const current = (await grafana.find(`/api/folders/${uid}`)) as { title?: string } | null
  const action = current === null ? 'create' : current.title === title ? 'keep' : 'update'
  context.plan.push({ kind: 'folder', id: uid, action })
  if (context.mode !== 'apply' || action === 'keep') return
  if (action === 'create') await grafana.send('POST', '/api/folders', { uid, title })
  else await grafana.send('PUT', `/api/folders/${uid}`, { title, overwrite: true })
}

async function resolveDatasource(
  context: ApplyContext,
  grafana: Client,
  explicit: string | undefined,
): Promise<string> {
  const uid = explicit ?? context.code.stack.defaultPrometheusUid
  const datasource = (await grafana.find(`/api/datasources/uid/${encodeURIComponent(uid)}`)) as {
    type?: string
  } | null
  if (datasource === null || datasource.type !== 'prometheus') {
    throw new Error(
      `datasource Prometheus ${uid} não encontrado na stack (defina GRAFANA_PROM_DATASOURCE_UID)`,
    )
  }
  return uid
}

/** Devolve se o contact point existe (ou existirá) depois do passo. */
async function applyContactPoint(
  context: ApplyContext,
  grafana: Client,
  emails: string | undefined,
): Promise<boolean> {
  const { name, uid } = context.code.stack.contactPoint
  const found = (await grafana.get(
    `/api/v1/provisioning/contact-points?name=${encodeURIComponent(name)}`,
  )) as { uid?: string }[]
  const exists = found.some((item) => item.uid === uid)
  if (emails === undefined) {
    context.plan.push({
      kind: 'contact-point',
      id: uid,
      action: exists ? 'keep' : 'skip',
      note: 'sem GRAFANA_ALERT_EMAILS',
    })
    if (!exists) warn(context, 'sem GRAFANA_ALERT_EMAILS: contact point e alertas não aplicados')
    return exists
  }
  const body = expandContactPoint(context.code.stack, emails)
  context.plan.push({ kind: 'contact-point', id: uid, action: exists ? 'update' : 'create' })
  if (context.mode === 'apply') {
    await (exists
      ? grafana.send('PUT', `/api/v1/provisioning/contact-points/${uid}`, body)
      : grafana.send('POST', '/api/v1/provisioning/contact-points', body))
  }
  return true
}

async function applyDashboards(context: ApplyContext, grafana: Client, sha: string): Promise<void> {
  for (const spec of context.code.dashboards) {
    const current = await grafana.find(`/api/dashboards/uid/${spec.uid}`)
    context.plan.push({
      kind: 'dashboard',
      id: spec.uid,
      action: current === null ? 'create' : 'update',
    })
    if (context.mode !== 'apply') continue
    await grafana.send('POST', '/api/dashboards/db', {
      dashboard: expandDashboard(spec),
      folderUid: context.code.stack.folder.uid,
      overwrite: true,
      message: `ops.yml (${sha})`,
    })
  }
}

async function applyRuleGroups(
  context: ApplyContext,
  grafana: Client,
  datasourceUid: string,
): Promise<void> {
  const folder = context.code.stack.folder.uid
  for (const group of context.code.alerts.groups) {
    const path = `/api/v1/provisioning/folder/${folder}/rule-groups/${encodeURIComponent(group.name)}`
    const current = await grafana.find(path)
    context.plan.push({
      kind: 'rule-group',
      id: group.name,
      action: current === null ? 'create' : 'update',
    })
    if (context.mode === 'apply') {
      await grafana.send('PUT', path, expandRuleGroup(context.code, group.name, datasourceUid))
    }
  }
}

interface RemoteCheck {
  readonly id: number
  readonly tenantId: number
  readonly job: string
}

/** Corpo do check com as sondas por ID (a API aceita nome, mas o ID não muda com o rótulo). */
export function checkBody(
  check: CheckSpec,
  probeIds: ReadonlyMap<string, number>,
): Record<string, unknown> {
  const probes = check.probes.map((name) => {
    const id = probeIds.get(name)
    if (id === undefined) throw new Error(`check ${check.job}: sonda pública ${name} não existe`)
    return id
  })
  return { ...check, probes }
}

async function applyChecks(context: ApplyContext, sm: Client): Promise<void> {
  const remote = (await sm.get('/api/v1/check')) as RemoteCheck[]
  const probes = (await sm.get('/api/v1/probe')) as { id: number; name: string }[]
  const probeIds = new Map(probes.map((probe) => [probe.name, probe.id]))
  const desired = new Set(context.code.checks.checks.map((check) => check.job))
  for (const check of context.code.checks.checks) {
    const body = checkBody(check, probeIds)
    const current = remote.find((item) => item.job === check.job)
    context.plan.push({
      kind: 'check',
      id: check.job,
      action: current === undefined ? 'create' : 'update',
      note: `${String(monthlyExecutions(check))} execuções/mês`,
    })
    if (context.mode !== 'apply') continue
    await (current === undefined
      ? sm.send('POST', '/api/v1/check', body)
      : sm.send('POST', `/api/v1/check/${String(current.id)}`, {
          ...body,
          id: current.id,
          tenantId: current.tenantId,
        }))
  }
  for (const stale of remote.filter(
    (item) => item.job.startsWith('teko-') && !desired.has(item.job),
  )) {
    context.plan.push({ kind: 'check', id: stale.job, action: 'delete' })
    if (context.mode === 'apply') await sm.send('DELETE', `/api/v1/check/${String(stale.id)}`)
  }
}

/** Plano (e, em `apply`, a aplicação) na ordem: pasta, contact point, dashboards, regras, checks. */
export async function applyGrafana(
  code: GrafanaAsCode,
  env: ApplyEnv,
  options: {
    readonly mode: Mode
    readonly fetch: typeof fetch
    readonly log: (line: string) => void
    readonly sha: string
  },
): Promise<PlanItem[]> {
  const context: ApplyContext = { code, mode: options.mode, plan: [], log: options.log }
  const grafana = client(grafanaBase(env.grafanaUrl, 'GRAFANA_URL'), env.saToken, options.fetch)
  await applyFolder(context, grafana)
  const datasourceUid = await resolveDatasource(context, grafana, env.promDatasourceUid)
  const receiver = await applyContactPoint(context, grafana, env.alertEmails)
  await applyDashboards(context, grafana, options.sha)
  if (receiver) {
    await applyRuleGroups(context, grafana, datasourceUid)
  } else {
    for (const group of code.alerts.groups) {
      context.plan.push({
        kind: 'rule-group',
        id: group.name,
        action: 'skip',
        note: 'sem contact point',
      })
    }
  }
  if (env.smUrl === undefined || env.smToken === undefined) {
    warn(
      context,
      'sem GRAFANA_SM_URL ou GRAFANA_SM_TOKEN: checks do Synthetic Monitoring não aplicados',
    )
    for (const check of code.checks.checks) {
      context.plan.push({ kind: 'check', id: check.job, action: 'skip', note: 'sem token do SM' })
    }
  } else {
    await applyChecks(
      context,
      client(grafanaBase(env.smUrl, 'GRAFANA_SM_URL'), env.smToken, options.fetch),
    )
  }
  return context.plan
}

function optional(name: string): string | undefined {
  const raw = process.env[name]?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

function summarize(code: GrafanaAsCode): string[] {
  const executions = code.checks.checks.map(
    (check) =>
      `| ${check.job} | ${check.target} | ${String(check.frequency / 60_000)} min | ${String(check.probes.length)} | ${String(monthlyExecutions(check))} |`,
  )
  const total = code.checks.checks.reduce((sum, check) => sum + monthlyExecutions(check), 0)
  return [
    '### Grafana as code',
    '',
    `${String(code.dashboards.length)} dashboards, ${String(code.alerts.rules.length)} regras em ${String(code.alerts.groups.length)} grupos, ${String(code.checks.checks.length)} checks.`,
    '',
    '| Check | Alvo | Frequência | Sondas | Execuções/mês |',
    '|---|---|---|---|---|',
    ...executions,
    `| **total** | | | | **${String(total)}** de 100.000 (Free) |`,
  ]
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      validate: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const code = loadGrafanaAsCode(GRAFANA_DIR)
  const errors = validate(code, knownRunbooks(REPO_ROOT), rawFiles(GRAFANA_DIR))
  for (const error of errors) console.log(`::error title=grafana-validate::${error}`)
  if (errors.length > 0) return 1
  const summary = summarize(code)
  const summaryFile = process.env['GITHUB_STEP_SUMMARY']
  const report = (lines: string[]) =>
    summaryFile
      ? appendFileSync(summaryFile, `${lines.join('\n')}\n`)
      : console.log(lines.join('\n'))
  report(summary)
  if (values.validate) return 0

  const grafanaUrl = optional('GRAFANA_URL')
  const saToken = optional('GRAFANA_SA_TOKEN')
  if (grafanaUrl === undefined || saToken === undefined) {
    console.log('::warning title=grafana-apply::sem GRAFANA_URL ou GRAFANA_SA_TOKEN: apply pulado')
    return 0
  }
  const mode: Mode = values['dry-run'] ? 'dry-run' : 'apply'
  const plan = await applyGrafana(
    code,
    {
      grafanaUrl,
      saToken,
      smUrl: optional('GRAFANA_SM_URL'),
      smToken: optional('GRAFANA_SM_TOKEN'),
      alertEmails: optional('GRAFANA_ALERT_EMAILS'),
      promDatasourceUid: optional('GRAFANA_PROM_DATASOURCE_UID'),
    },
    {
      mode,
      fetch,
      log: (line) => console.log(line),
      sha: (optional('GITHUB_SHA') ?? 'local').slice(0, 7),
    },
  )
  report([
    '',
    `#### Plano (${mode})`,
    '',
    '| Recurso | ID | Ação | Nota |',
    '|---|---|---|---|',
    ...plan.map((item) => `| ${item.kind} | ${item.id} | ${item.action} | ${item.note ?? ''} |`),
  ])
  return 0
}

if (import.meta.main) {
  exit(await main())
}
