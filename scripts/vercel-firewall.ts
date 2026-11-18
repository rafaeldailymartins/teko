/**
 * Aplica as regras custom do WAF de `infra/vercel/firewall-rules.json` ao projeto Vercel de um
 * ambiente (F7, mudança OpenSpec add-vercel-deployment), pela API REST de firewall:
 * `GET /v1/security/firewall/config/active` e `PATCH /v1/security/firewall/config` com
 * `rules.insert` (regra nova) ou `rules.update` (regra de mesmo nome com conteúdo diferente).
 * Idempotente: compara por nome, com a forma canônica de cada regra (sem `id`, nulos nem
 * `neg: false`), e só escreve o que difere. Regra do projeto fora do JSON fica como está (aviso).
 *
 * **Lockdown.** O JSON traz, por projeto, o payload `lockdown`: a regra 1 (`deny-unknown-api`)
 * passa a redirecionar (307, `permanent: false`) para a página de aviso `/aviso/` tudo exceto
 * `/healthz`, `/api/healthz`, a própria página, `/_next/static/*` e `/favicon.ico`.
 *
 * - `--lockdown on`: grava o payload de lockdown no lugar da regra 1 (o guarda de uso, a 95% de
 *   uma cota, ou o mantenedor pelo runbook);
 * - `--lockdown off`: volta a regra 1 ao normal;
 * - sem `--lockdown` (o sync de cada deploy): se o lockdown estiver ativo, a regra 1 fica como
 *   está, com `::warning`; as regras 2 e 3 são sincronizadas normalmente. O lockdown é reconhecido
 *   pela forma canônica igual à do payload ou pela descrição começando com `LOCKDOWN`.
 *
 * Contrato fixo (o guarda de uso do `ops.yml` chama este script):
 *
 *   node scripts/vercel-firewall.ts --env staging|production [--lockdown on|off] [--dry-run]
 *
 * Ambiente: `VERCEL_TOKEN`, `VERCEL_ORG_ID` e, opcional, `VERCEL_PROJECT_ID` (precisa ser o projeto
 * do `--env`; os ids são constantes em `scripts/lib/vercel-api.ts`). Com `GITHUB_OUTPUT`, grava
 * `lockdown=on|off` (o estado depois do script; no dry-run, o estado lido) e `changes=<n>`.
 * Saída: 0 ok; 1 erro da API, JSON inválido ou firewall desligado no projeto; 2 uso errado.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { compareCodeUnits } from './lib/cli-guards.ts'
import {
  assertProject,
  createVercelApi,
  credentialsFromEnv,
  DEPLOY_ENVS,
  type DeployEnv,
  logLine,
  messageOf,
  parseDeployEnv,
  VERCEL_PROJECTS,
  type VercelApi,
  VercelApiError,
  type VercelProject,
} from './lib/vercel-api.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Nome da regra que o lockdown substitui. */
export const LOCKDOWN_RULE = 'deny-unknown-api'
/** Prefixo da descrição do payload de lockdown (também reconhece um lockdown gravado à mão). */
export const LOCKDOWN_PREFIX = 'LOCKDOWN'
/** Destino do redirect do lockdown: a página de aviso do export do web (`apps/web/src/app/aviso`). */
export const LOCKDOWN_LOCATION = '/aviso/'

const USAGE = `uso: node scripts/vercel-firewall.ts --env ${DEPLOY_ENVS.join('|')} [--lockdown on|off] [--dry-run]`

class UsageError extends Error {}
class RulesFileError extends Error {}

export type Rule = Readonly<Record<string, unknown>> & { readonly name: string }

export interface ProjectRules {
  readonly rules: readonly Rule[]
  readonly lockdown: Rule
}

const isObject = (item: unknown): item is Record<string, unknown> =>
  typeof item === 'object' && item !== null && !Array.isArray(item)

function asRule(item: unknown, where: string): Rule {
  if (
    !isObject(item) ||
    typeof item['name'] !== 'string' ||
    typeof item['active'] !== 'boolean' ||
    !Array.isArray(item['conditionGroup']) ||
    !isObject(item['action'])
  ) {
    throw new RulesFileError(`${where}: regra sem name, active, conditionGroup ou action`)
  }
  return item as Rule
}

/**
 * O lockdown leva à página de aviso por redirect temporário (307): permanente, o navegador o
 * guardaria e continuaria indo para o aviso depois do `--lockdown off`.
 */
function redirectsToNotice(lockdown: Rule): boolean {
  const action = lockdown['action']
  const mitigate = isObject(action) ? action['mitigate'] : undefined
  const redirect = isObject(mitigate) ? mitigate['redirect'] : undefined
  return (
    isObject(mitigate) &&
    mitigate['action'] === 'redirect' &&
    isObject(redirect) &&
    redirect['location'] === LOCKDOWN_LOCATION &&
    redirect['permanent'] === false
  )
}

/** Valida e lê as regras de um projeto de `firewall-rules.json`. */
export function parseProjectRules(raw: unknown, projectName: string): ProjectRules {
  const projects = isObject(raw) ? raw['projects'] : undefined
  const entry = isObject(projects) ? projects[projectName] : undefined
  if (!isObject(entry) || !Array.isArray(entry['rules'])) {
    throw new RulesFileError(`firewall-rules.json sem projects.${projectName}.rules`)
  }
  const rules = entry['rules'].map((item, index) =>
    asRule(item, `${projectName}.rules[${String(index)}]`),
  )
  const names = rules.map((rule) => rule.name)
  if (new Set(names).size !== names.length) {
    throw new RulesFileError(`${projectName}: nomes de regra repetidos`)
  }
  // Hobby: 3 regras custom.
  if (rules.length > 3) {
    throw new RulesFileError(`${projectName}: ${String(rules.length)} regras; o Hobby aceita 3`)
  }
  const lockdown = asRule(entry['lockdown'], `${projectName}.lockdown`)
  if (lockdown.name !== LOCKDOWN_RULE || !names.includes(LOCKDOWN_RULE)) {
    throw new RulesFileError(
      `${projectName}: o lockdown precisa substituir a regra ${LOCKDOWN_RULE}`,
    )
  }
  if (!String(lockdown['description'] ?? '').startsWith(LOCKDOWN_PREFIX)) {
    throw new RulesFileError(
      `${projectName}: a descrição do lockdown precisa começar com ${LOCKDOWN_PREFIX}`,
    )
  }
  if (!redirectsToNotice(lockdown)) {
    throw new RulesFileError(
      `${projectName}: o lockdown precisa redirecionar para ${LOCKDOWN_LOCATION} com permanent: false`,
    )
  }
  if (JSON.stringify(entry).includes('"challenge"')) {
    throw new RulesFileError(`${projectName}: nenhuma regra pode usar challenge`)
  }
  return { rules, lockdown }
}

/** Campos que a Vercel acrescenta e que não fazem parte do conteúdo da regra. */
const VOLATILE = new Set(['id', 'valid', 'validationErrors'])

function canonicalValue(item: unknown): unknown {
  if (Array.isArray(item)) {
    return item.map(canonicalValue)
  }
  if (!isObject(item)) {
    return item
  }
  const entries = Object.entries(item)
    .filter(([key, val]) => val !== null && val !== undefined && !(key === 'neg' && val === false))
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([key, val]) => [key, canonicalValue(val)] as const)
  return Object.fromEntries(entries)
}

/** Forma canônica de uma regra para comparação (sem `id`, nulos nem `neg: false`). */
export function canonicalRule(rule: Readonly<Record<string, unknown>>): string {
  const content = Object.fromEntries(Object.entries(rule).filter(([key]) => !VOLATILE.has(key)))
  return JSON.stringify(canonicalValue(content))
}

/** A regra ativa é o payload de lockdown (pela forma ou pela descrição). */
export function isLockdown(rule: Readonly<Record<string, unknown>>, lockdown: Rule): boolean {
  return (
    canonicalRule(rule) === canonicalRule(lockdown) ||
    String(rule['description'] ?? '').startsWith(LOCKDOWN_PREFIX)
  )
}

export interface ActiveConfig {
  readonly firewallEnabled: boolean | undefined
  readonly rules: readonly (Rule & { readonly id: string })[]
}

/** Lê a resposta do `GET .../config/active` (a config direto ou dentro de `active`). */
export function parseActiveConfig(body: unknown): ActiveConfig {
  const config = isObject(body) && isObject(body['active']) ? body['active'] : body
  if (!isObject(config)) {
    return { firewallEnabled: undefined, rules: [] }
  }
  const rawRules = Array.isArray(config['rules']) ? config['rules'] : []
  const rules = rawRules.flatMap((item: unknown) =>
    isObject(item) && typeof item['name'] === 'string' && typeof item['id'] === 'string'
      ? [item as Rule & { id: string }]
      : [],
  )
  const enabled = config['firewallEnabled']
  return { firewallEnabled: typeof enabled === 'boolean' ? enabled : undefined, rules }
}

export type LockdownMode = 'on' | 'off' | undefined

export type FirewallAction =
  | { readonly action: 'rules.insert'; readonly id: null; readonly value: Rule }
  | { readonly action: 'rules.update'; readonly id: string; readonly value: Rule }

export interface FirewallPlan {
  readonly actions: readonly FirewallAction[]
  /** Estado do lockdown depois de aplicar o plano. */
  readonly lockdown: 'on' | 'off'
  /** O lockdown ativo foi mantido pelo sync sem `--lockdown`. */
  readonly keptLockdown: boolean
  readonly duplicated: readonly string[]
  readonly unmanaged: readonly string[]
}

/** Plano de escrita a partir da config ativa e das regras do JSON; não chama a API. */
export function planFirewall(
  active: ActiveConfig,
  wanted: ProjectRules,
  mode: LockdownMode,
): FirewallPlan {
  const byName = new Map<string, (typeof active.rules)[number]>()
  const duplicated: string[] = []
  for (const rule of active.rules) {
    if (byName.has(rule.name)) {
      duplicated.push(rule.name)
    }
    byName.set(rule.name, rule)
  }
  const current = byName.get(LOCKDOWN_RULE)
  const activeLockdown = current !== undefined && isLockdown(current, wanted.lockdown)
  const keptLockdown = mode === undefined && activeLockdown
  const lockdownOn = mode === 'on' || keptLockdown
  const actions: FirewallAction[] = []
  for (const rule of wanted.rules) {
    if (rule.name === LOCKDOWN_RULE && keptLockdown) {
      continue
    }
    const desired = rule.name === LOCKDOWN_RULE && lockdownOn ? wanted.lockdown : rule
    const existing = byName.get(rule.name)
    if (existing === undefined) {
      actions.push({ action: 'rules.insert', id: null, value: desired })
    } else if (canonicalRule(existing) !== canonicalRule(desired)) {
      actions.push({ action: 'rules.update', id: existing.id, value: desired })
    }
  }
  const managed = new Set(wanted.rules.map((rule) => rule.name))
  const unmanaged = [...byName.keys()].filter((name) => !managed.has(name)).sort(compareCodeUnits)
  return { actions, lockdown: lockdownOn ? 'on' : 'off', keptLockdown, duplicated, unmanaged }
}

export interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
  readonly readRules: () => unknown
}

function readRulesFile(): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'infra', 'vercel', 'firewall-rules.json'), 'utf8'))
}

async function readActive(api: VercelApi, project: VercelProject): Promise<ActiveConfig> {
  try {
    return parseActiveConfig(
      await api('GET', '/v1/security/firewall/config/active', { query: { projectId: project.id } }),
    )
  } catch (error) {
    // Projeto sem nenhuma config de firewall ainda: nada ativo, tudo vira insert.
    if (error instanceof VercelApiError && error.status === 404) {
      return { firewallEnabled: undefined, rules: [] }
    }
    throw error
  }
}

export interface RunResult {
  readonly code: number
  readonly summary: string[]
  readonly lockdown?: 'on' | 'off'
  readonly changes?: number
}

/** Sync (ou lockdown) de um projeto; código 0 ok, 1 falha. */
export async function run(
  deps: RunDeps,
  options: { readonly env: DeployEnv; readonly lockdown: LockdownMode; readonly dryRun: boolean },
): Promise<RunResult> {
  const project = VERCEL_PROJECTS[options.env]
  const summary = [`### vercel-firewall (${project.name})`, '']
  const fail = (message: string): RunResult => {
    deps.log(`::error title=vercel-firewall::${message}`)
    summary.push(`Falhou: ${message}`)
    return { code: 1, summary }
  }
  try {
    const wanted = parseProjectRules(deps.readRules(), project.name)
    const api = createVercelApi(credentialsFromEnv(deps.env, options.env), deps.fetch)
    await assertProject(api, project)
    const active = await readActive(api, project)
    if (active.firewallEnabled === false) {
      return fail(`o firewall está desligado no ${project.name}; ligue-o no dashboard (Firewall)`)
    }
    const plan = planFirewall(active, wanted, options.lockdown)
    if (plan.duplicated.length > 0) {
      return fail(
        `regras repetidas no projeto: ${plan.duplicated.join(', ')}; apague as sobras no dashboard`,
      )
    }
    if (plan.keptLockdown) {
      deps.log(
        `::warning title=vercel-firewall::lockdown ativo no ${project.name}: a regra ${LOCKDOWN_RULE} fica como está (saída: --lockdown off, runbook quota-exhausted.md)`,
      )
    }
    for (const name of plan.unmanaged) {
      deps.log(
        `::warning title=vercel-firewall::regra ${name} no ${project.name} fora do firewall-rules.json (não tocada)`,
      )
    }
    if (!options.dryRun) {
      for (const action of plan.actions) {
        await api('PATCH', '/v1/security/firewall/config', {
          query: { projectId: project.id },
          body: action,
        })
      }
    }
    const verb = options.dryRun ? 'a aplicar (dry-run)' : 'aplicada'
    for (const action of plan.actions) {
      deps.log(`${action.action} ${action.value.name}: ${verb}`)
    }
    const lockdown = options.dryRun
      ? active.rules.some(
          (rule) => rule.name === LOCKDOWN_RULE && isLockdown(rule, wanted.lockdown),
        )
        ? 'on'
        : 'off'
      : plan.lockdown
    summary.push(
      `- Regras: ${String(plan.actions.length)} alteração(ões) ${options.dryRun ? 'planejadas (dry-run, nada escrito)' : 'aplicadas'}, de ${String(wanted.rules.length)} no JSON.`,
      ...plan.actions.map((action) => `  - \`${action.action}\` \`${action.value.name}\``),
      `- Lockdown: ${lockdown}${plan.keptLockdown ? ' (mantido pelo sync; saída com --lockdown off)' : ''}.`,
    )
    return { code: 0, summary, lockdown, changes: plan.actions.length }
  } catch (error) {
    return fail(messageOf(error))
  }
}

function parseOptions(): { env: DeployEnv; lockdown: LockdownMode; dryRun: boolean } {
  let values: {
    env?: string | undefined
    lockdown?: string | undefined
    'dry-run'?: boolean | undefined
  }
  try {
    values = parseArgs({
      options: {
        env: { type: 'string' },
        lockdown: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new UsageError(messageOf(error))
  }
  const env = parseDeployEnv(values.env)
  if (env === undefined) {
    throw new UsageError(
      values.env === undefined
        ? '--env é obrigatório'
        : `--env ${JSON.stringify(values.env)} desconhecido`,
    )
  }
  const lockdown = values.lockdown
  if (lockdown !== undefined && lockdown !== 'on' && lockdown !== 'off') {
    throw new UsageError(`--lockdown ${JSON.stringify(lockdown)} desconhecido (on ou off)`)
  }
  return { env, lockdown, dryRun: values['dry-run'] === true }
}

async function main(): Promise<number> {
  let options: ReturnType<typeof parseOptions>
  try {
    options = parseOptions()
  } catch (error) {
    console.error(`vercel-firewall: ${messageOf(error)}`)
    console.error(USAGE)
    return 2
  }
  const result = await run(
    { env: process.env, fetch, log: logLine, readRules: readRulesFile },
    options,
  )
  const summaryFile = process.env['GITHUB_STEP_SUMMARY']
  if (summaryFile) {
    appendFileSync(summaryFile, `${result.summary.join('\n')}\n`)
  } else {
    console.log(result.summary.join('\n'))
  }
  const outputFile = process.env['GITHUB_OUTPUT']
  if (outputFile && result.lockdown !== undefined) {
    appendFileSync(
      outputFile,
      `lockdown=${result.lockdown}\nchanges=${String(result.changes ?? 0)}\n`,
    )
  }
  return result.code
}

if (import.meta.main) {
  process.exitCode = await main()
}
