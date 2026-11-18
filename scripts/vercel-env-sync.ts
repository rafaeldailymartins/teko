/**
 * Sync das env vars do projeto Vercel de um ambiente antes de cada deploy (F7, mudança OpenSpec
 * add-vercel-deployment; `infra/vercel/README.md`, "Variáveis de ambiente"):
 *
 * 1. **Sensitive:** toda env var do campo `sensitive` de `infra/vercel/env.<env>.json` com
 *    `requiredFrom` até a fase atual (`CURRENT_PHASE`) precisa existir no ambiente Production do
 *    projeto. Faltou alguma: o script lista os nomes e termina com 1 ANTES de escrever qualquer
 *    coisa. Valor de Sensitive nunca é lido (a API não devolve) nem impresso.
 * 2. **Config:** cada entrada do campo `config` com `since` até a fase atual vira env var não
 *    sensível (`encrypted`, a mesma do `vercel env add --no-sensitive`) no ambiente Production. Só
 *    o que muda é escrito: a que falta é criada (`POST /v10/projects/{id}/env`), a de valor
 *    diferente é editada (`PATCH /v9/projects/{id}/env/{envId}`) e a igual fica. Uma Config que no
 *    projeto é Sensitive para o script (o mantenedor resolve à mão).
 *
 * Nunca toca `LLM_KILL_SWITCH` (só o guarda de uso e o mantenedor o gravam, e um sync de deploy não
 * pode desligá-lo): o JSON é recusado se a citar, e ela não está em nenhuma escrita. `GIT_SHA` e
 * `APP_VERSION` também não podem existir no projeto: vêm do `.vc-config.json` do artefato
 * (`scripts/build-vercel-output.ts`). Env vars do projeto fora do JSON ficam como estão (o resumo
 * só cita os nomes).
 *
 * Uso: node scripts/vercel-env-sync.ts --env staging|production [--dry-run]
 *
 * Ambiente: `VERCEL_TOKEN`, `VERCEL_ORG_ID` e, opcional, `VERCEL_PROJECT_ID` (precisa ser o projeto
 * do `--env`; ver `scripts/lib/vercel-api.ts`). Saída: 0 ok; 1 Sensitive faltando, erro da API ou
 * JSON inválido; 2 uso errado. O resumo vai para o `GITHUB_STEP_SUMMARY`, só com nomes.
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
  type VercelProject,
} from './lib/vercel-api.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Fase do roteiro em curso: Config com `since` e Sensitive com `requiredFrom` até ela valem. */
export const CURRENT_PHASE = 'F7'

/** Nunca escritas pelo sync (ver o cabeçalho). */
export const UNTOUCHABLE = 'LLM_KILL_SWITCH'
/** Vêm do artefato e não podem existir no projeto. */
export const FROM_ARTIFACT = ['GIT_SHA', 'APP_VERSION'] as const

const TARGET = 'production'
const CONFIG_TYPE = 'encrypted'
const NAME = /^[A-Z][A-Z0-9_]{0,127}$/
const PHASE = /^F(\d{1,2})$/

const USAGE = `uso: node scripts/vercel-env-sync.ts --env ${DEPLOY_ENVS.join('|')} [--dry-run]`

class UsageError extends Error {}
class EnvFileError extends Error {}

export interface EnvSpec {
  readonly project: string
  readonly config: ReadonlyMap<string, { readonly value: string; readonly since: string }>
  readonly sensitive: ReadonlyMap<string, { readonly requiredFrom: string }>
}

function phaseNumber(phase: string, where: string): number {
  const match = PHASE.exec(phase)
  if (match?.[1] === undefined) {
    throw new EnvFileError(`${where}: fase ${JSON.stringify(phase)} fora do formato F<n>`)
  }
  return Number(match[1])
}

/** A fase `phase` já chegou (`F4` <= `F7`). */
export function reached(phase: string, current = CURRENT_PHASE): boolean {
  return phaseNumber(phase, 'fase') <= phaseNumber(current, 'fase atual')
}

const isObject = (item: unknown): item is Record<string, unknown> =>
  typeof item === 'object' && item !== null && !Array.isArray(item)

/** Valida e lê `infra/vercel/env.<env>.json`. */
export function parseEnvSpec(raw: unknown, file: string): EnvSpec {
  if (!isObject(raw) || typeof raw['project'] !== 'string') {
    throw new EnvFileError(`${file}: sem o campo project`)
  }
  const configRaw = raw['config']
  const sensitiveRaw = raw['sensitive']
  if (!isObject(configRaw) || !isObject(sensitiveRaw)) {
    throw new EnvFileError(`${file}: config e sensitive precisam ser objetos`)
  }
  const config = new Map<string, { value: string; since: string }>()
  for (const [name, entry] of Object.entries(configRaw)) {
    if (!NAME.test(name)) {
      throw new EnvFileError(`${file}: nome inválido ${JSON.stringify(name)}`)
    }
    if (
      !isObject(entry) ||
      typeof entry['value'] !== 'string' ||
      typeof entry['since'] !== 'string'
    ) {
      throw new EnvFileError(`${file}: config.${name} sem value ou since em texto`)
    }
    phaseNumber(entry['since'], `${file}: config.${name}`)
    config.set(name, { value: entry['value'], since: entry['since'] })
  }
  const sensitive = new Map<string, { requiredFrom: string }>()
  for (const [name, entry] of Object.entries(sensitiveRaw)) {
    if (!NAME.test(name)) {
      throw new EnvFileError(`${file}: nome inválido ${JSON.stringify(name)}`)
    }
    if (!isObject(entry) || typeof entry['requiredFrom'] !== 'string') {
      throw new EnvFileError(`${file}: sensitive.${name} sem requiredFrom em texto`)
    }
    phaseNumber(entry['requiredFrom'], `${file}: sensitive.${name}`)
    if (config.has(name)) {
      throw new EnvFileError(`${file}: ${name} está em config e em sensitive`)
    }
    sensitive.set(name, { requiredFrom: entry['requiredFrom'] })
  }
  for (const name of [UNTOUCHABLE, ...FROM_ARTIFACT]) {
    if (config.has(name) || sensitive.has(name)) {
      throw new EnvFileError(
        `${file}: ${name} não pode estar no JSON (ver scripts/vercel-env-sync.ts)`,
      )
    }
  }
  return { project: raw['project'], config, sensitive }
}

/** Env var do projeto como a listagem devolve (sem valor). */
export interface ProjectEnv {
  readonly id: string
  readonly key: string
  readonly type: string
  readonly target: readonly string[]
}

function asProjectEnvs(body: unknown): ProjectEnv[] {
  const envs: unknown = isObject(body) ? body['envs'] : undefined
  if (!Array.isArray(envs)) {
    throw new Error('GET /v10/projects/{id}/env sem envs')
  }
  return envs.flatMap((item: unknown) => {
    if (!isObject(item) || typeof item['id'] !== 'string' || typeof item['key'] !== 'string') {
      return []
    }
    // Env var de branch (Preview) não vale para os deploys --prod.
    if (typeof item['gitBranch'] === 'string' && item['gitBranch'] !== '') {
      return []
    }
    const target = item['target']
    const targets = Array.isArray(target)
      ? target.filter((t): t is string => typeof t === 'string')
      : typeof target === 'string'
        ? [target]
        : []
    return [
      {
        id: item['id'],
        key: item['key'],
        type: typeof item['type'] === 'string' ? item['type'] : 'unknown',
        target: targets,
      },
    ]
  })
}

const isSensitiveType = (type: string): boolean => type === 'sensitive' || type === 'secret'

export type ConfigAction =
  | { readonly kind: 'create'; readonly name: string; readonly value: string }
  | { readonly kind: 'update'; readonly name: string; readonly id: string; readonly value: string }
  | { readonly kind: 'keep'; readonly name: string }

export interface SyncPlan {
  readonly missingSensitive: readonly string[]
  /** Sensitive que existe no projeto, mas com tipo não sensível (aviso). */
  readonly notSensitive: readonly string[]
  /** Config que no projeto é Sensitive (erro: o mantenedor resolve à mão). */
  readonly configAsSensitive: readonly string[]
  /** `GIT_SHA`/`APP_VERSION` no projeto (erro). */
  readonly fromArtifact: readonly string[]
  /** Config a conferir: o valor atual é lido por id antes de decidir entre `keep` e `update`. */
  readonly configChecks: readonly {
    readonly name: string
    readonly value: string
    readonly existing: ProjectEnv | undefined
  }[]
  /** Env vars do projeto fora do JSON (só os nomes). */
  readonly unmanaged: readonly string[]
}

/** Plano do sync a partir da listagem (sem valores) e do JSON; não chama a API. */
export function planSync(
  spec: EnvSpec,
  envs: readonly ProjectEnv[],
  phase = CURRENT_PHASE,
): SyncPlan {
  const production = envs.filter((env) => env.target.includes(TARGET))
  const byKey = new Map<string, ProjectEnv>()
  for (const env of production) {
    if (!byKey.has(env.key)) {
      byKey.set(env.key, env)
    }
  }
  const missingSensitive: string[] = []
  const notSensitive: string[] = []
  for (const [name, entry] of spec.sensitive) {
    const existing = byKey.get(name)
    if (existing === undefined) {
      if (reached(entry.requiredFrom, phase)) {
        missingSensitive.push(name)
      }
    } else if (!isSensitiveType(existing.type)) {
      notSensitive.push(name)
    }
  }
  const configAsSensitive: string[] = []
  const configChecks: SyncPlan['configChecks'][number][] = []
  for (const [name, entry] of spec.config) {
    if (!reached(entry.since, phase)) {
      continue
    }
    const existing = byKey.get(name)
    if (existing !== undefined && isSensitiveType(existing.type)) {
      configAsSensitive.push(name)
      continue
    }
    configChecks.push({ name, value: entry.value, existing })
  }
  const managed = new Set([...spec.config.keys(), ...spec.sensitive.keys()])
  const fromArtifact = FROM_ARTIFACT.filter((name) => byKey.has(name))
  const unmanaged = [...byKey.keys()]
    .filter((key) => !managed.has(key) && !FROM_ARTIFACT.some((name) => name === key))
    .sort(compareCodeUnits)
  const sorted = (items: string[]) => items.sort(compareCodeUnits)
  return {
    missingSensitive: sorted(missingSensitive),
    notSensitive: sorted(notSensitive),
    configAsSensitive: sorted(configAsSensitive),
    fromArtifact,
    configChecks,
    unmanaged,
  }
}

export interface RunDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
  /** Lê `infra/vercel/env.<env>.json` (injetável nos testes). */
  readonly readSpec: (env: DeployEnv) => unknown
}

function readSpecFile(env: DeployEnv): unknown {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'infra', 'vercel', `env.${env}.json`), 'utf8'))
}

async function decideConfig(
  api: VercelApi,
  project: VercelProject,
  check: SyncPlan['configChecks'][number],
): Promise<ConfigAction> {
  if (check.existing === undefined) {
    return { kind: 'create', name: check.name, value: check.value }
  }
  const body = await api(
    'GET',
    `/v1/projects/${encodeURIComponent(project.id)}/env/${encodeURIComponent(check.existing.id)}`,
  )
  const current: unknown = isObject(body) ? body['value'] : undefined
  return current === check.value
    ? { kind: 'keep', name: check.name }
    : { kind: 'update', name: check.name, id: check.existing.id, value: check.value }
}

async function apply(api: VercelApi, project: VercelProject, action: ConfigAction): Promise<void> {
  const base = `/v10/projects/${encodeURIComponent(project.id)}/env`
  if (action.kind === 'create') {
    await api('POST', base, {
      body: { key: action.name, value: action.value, type: CONFIG_TYPE, target: [TARGET] },
    })
  } else if (action.kind === 'update') {
    await api(
      'PATCH',
      `/v9/projects/${encodeURIComponent(project.id)}/env/${encodeURIComponent(action.id)}`,
      {
        // Sem `target`: a env var pode valer também para outros ambientes do projeto, e o sync não
        // os tira.
        body: { value: action.value, type: CONFIG_TYPE },
      },
    )
  }
}

/** Sync de um ambiente; código 0 ok, 1 falha. Nenhuma linha leva valor de env var. */
export async function run(
  deps: RunDeps,
  options: { readonly env: DeployEnv; readonly dryRun: boolean },
): Promise<{ code: number; summary: string[] }> {
  const project = VERCEL_PROJECTS[options.env]
  const summary = [`### vercel-env-sync (${project.name})`, '']
  const fail = (message: string) => {
    deps.log(`::error title=vercel-env-sync::${message}`)
    summary.push(`Falhou: ${message}`)
    return { code: 1, summary }
  }
  let spec: EnvSpec
  try {
    spec = parseEnvSpec(deps.readSpec(options.env), `infra/vercel/env.${options.env}.json`)
  } catch (error) {
    return fail(messageOf(error))
  }
  if (spec.project !== project.name) {
    return fail(`env.${options.env}.json é do projeto ${spec.project}, não ${project.name}`)
  }
  try {
    const credentials = credentialsFromEnv(deps.env, options.env)
    const api = createVercelApi(credentials, deps.fetch)
    await assertProject(api, project)
    const envs = asProjectEnvs(
      await api('GET', `/v10/projects/${encodeURIComponent(project.id)}/env`),
    )
    const plan = planSync(spec, envs)
    for (const name of plan.notSensitive) {
      deps.log(
        `::warning title=vercel-env-sync::${name} existe no ${project.name}, mas não é Sensitive; regrave-a com --sensitive`,
      )
    }
    const blocking = [
      ...(plan.missingSensitive.length > 0
        ? [
            `faltam as Sensitive ${plan.missingSensitive.join(', ')} no ambiente Production do ${project.name} (o mantenedor grava: vercel env add NOME production --sensitive)`,
          ]
        : []),
      ...(plan.configAsSensitive.length > 0
        ? [
            `${plan.configAsSensitive.join(', ')} são Config no repositório, mas Sensitive no projeto`,
          ]
        : []),
      ...(plan.fromArtifact.length > 0
        ? [
            `${plan.fromArtifact.join(', ')} não podem existir no projeto (vêm do .vc-config.json do artefato)`,
          ]
        : []),
    ]
    if (blocking.length > 0) {
      return fail(`${blocking.join('; ')}. Nada foi escrito.`)
    }
    const actions: ConfigAction[] = []
    for (const check of plan.configChecks) {
      actions.push(await decideConfig(api, project, check))
    }
    const changes = actions.filter((action) => action.kind !== 'keep')
    if (!options.dryRun) {
      for (const action of changes) {
        await apply(api, project, action)
      }
    }
    const verb = options.dryRun ? 'a ' : ''
    const label = { create: `${verb}criar`, update: `${verb}atualizar`, keep: 'em dia' } as const
    for (const action of changes) {
      deps.log(`${label[action.kind]}: ${action.name}`)
    }
    summary.push(
      `- Config: ${String(changes.length)} alterada(s)${options.dryRun ? ' (dry-run, nada escrito)' : ''}, ${String(actions.length - changes.length)} em dia.`,
      ...changes.map((action) => `  - ${label[action.kind]} \`${action.name}\``),
      `- Sensitive obrigatórias até a ${CURRENT_PHASE}: todas presentes (${String(spec.sensitive.size)} no JSON).`,
      ...(plan.unmanaged.length > 0
        ? [
            `- Fora do JSON (não tocadas): ${plan.unmanaged.map((name) => `\`${name}\``).join(', ')}.`,
          ]
        : []),
    )
    return { code: 0, summary }
  } catch (error) {
    return fail(messageOf(error))
  }
}

function parseOptions(): { env: DeployEnv; dryRun: boolean } {
  let values: { env?: string | undefined; 'dry-run'?: boolean | undefined }
  try {
    values = parseArgs({
      options: { env: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
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
  return { env, dryRun: values['dry-run'] === true }
}

async function main(): Promise<number> {
  let options: { env: DeployEnv; dryRun: boolean }
  try {
    options = parseOptions()
  } catch (error) {
    console.error(`vercel-env-sync: ${messageOf(error)}`)
    console.error(USAGE)
    return 2
  }
  const { code, summary } = await run(
    { env: process.env, fetch, log: logLine, readSpec: readSpecFile },
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
  process.exitCode = await main()
}
