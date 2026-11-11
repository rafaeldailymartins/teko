/**
 * Cria os roles de login do Tekó num projeto Neon pela API e grava as URLs de conexão como segredos
 * dos GitHub Environments, sem nunca imprimir senha nem URL (plano: Backend > Roles e privilégio
 * mínimo; runbook `docs/runbooks/neon-roles.md`).
 *
 * - `teko_app` (runtime e manutenção semanal) e `teko_watch` (source-watch) são criados no branch
 *   padrão, com senha gerada pelo Neon. Um role que já existe não é recriado nem tem a senha trocada
 *   (só com `--reset-password`).
 * - Para cada segredo de destino que ainda não existe no environment, a URL `-pooler` vem de
 *   `GET /projects/{id}/connection_uri` e vai para o `gh secret set` pelo stdin.
 * - Os grants e os timeouts ficam na migração (`drizzle/migrations/*_constraints-grants`): rode este
 *   script ANTES da primeira migração de cada projeto, para o bloco de grants achar os roles.
 *
 * Uso (o mantenedor, na própria máquina, com o `gh` autenticado):
 *   node scripts/neon-roles.ts --env staging --project <id-do-projeto> [--dry-run]
 *   node scripts/neon-roles.ts --env production --project <id-do-projeto> [--reset-password]
 *
 * A API key é do projeto (project-scoped). Sem `NEON_API_KEY` no ambiente, o script a pede no
 * terminal sem eco, e ela não fica no histórico do shell nem em disco. O ID do projeto não é
 * segredo (`--project` ou `NEON_PROJECT_ID`).
 */
import { execFileSync } from 'node:child_process'
import { exit } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { parseArgs } from 'node:util'
import { CliGuardError, findOnSafePath } from './lib/cli-guards.ts'

export const NEON_API = 'https://console.neon.tech/api/v2'
export const DATABASE_NAME = 'neondb'

export const RoleName = {
  App: 'teko_app',
  Watch: 'teko_watch',
} as const
export type RoleName = (typeof RoleName)[keyof typeof RoleName]

export interface SecretTarget {
  /** GitHub Environment. */
  readonly environment: string
  readonly secret: string
}

export type Target = 'staging' | 'production'

/** Onde cada URL vai, por projeto (plano: CI/CD > Environments e segredos). */
export const SECRET_TARGETS: Readonly<
  Record<Target, Readonly<Record<RoleName, readonly SecretTarget[]>>>
> = {
  staging: {
    teko_app: [
      { environment: 'staging', secret: 'NEON_STAGING_APP_URL' },
      { environment: 'maintenance', secret: 'NEON_STAGING_APP_URL' },
    ],
    teko_watch: [{ environment: 'corpus-watch', secret: 'NEON_STAGING_WATCH_URL' }],
  },
  production: {
    teko_app: [{ environment: 'maintenance', secret: 'NEON_PROD_APP_URL' }],
    teko_watch: [{ environment: 'corpus-watch', secret: 'NEON_PROD_WATCH_URL' }],
  },
}

export interface RolePlan {
  readonly role: RoleName
  /** `create` (não existe), `reset` (`--reset-password`) ou `keep`. */
  readonly action: 'create' | 'reset' | 'keep'
  /** Segredos a gravar (todos, se a senha muda; senão só os que faltam). */
  readonly secrets: readonly SecretTarget[]
}

/** Decide o que fazer com cada role, a partir do estado atual (roles e segredos que já existem). */
export function planRoles(
  target: Target,
  existingRoles: ReadonlySet<string>,
  existingSecrets: ReadonlyMap<string, ReadonlySet<string>>,
  resetPassword: boolean,
): RolePlan[] {
  return Object.values(RoleName).map((role) => {
    const targets = SECRET_TARGETS[target][role]
    let action: RolePlan['action'] = 'keep'
    if (!existingRoles.has(role)) {
      action = 'create'
    } else if (resetPassword) {
      action = 'reset'
    }
    const secrets =
      action === 'keep'
        ? targets.filter(
            ({ environment, secret }) => !existingSecrets.get(environment)?.has(secret),
          )
        : targets
    return { role, action, secrets }
  })
}

export function describePlan(plan: readonly RolePlan[]): string[] {
  return plan.map(({ role, action, secrets }) => {
    const destinations = secrets.map(({ environment, secret }) => `${environment}/${secret}`)
    return `${role}: ${action}; segredos a gravar: ${destinations.join(', ') || 'nenhum'}`
  })
}

interface NeonClient {
  get(path: string): Promise<unknown>
  post(path: string, body: unknown): Promise<unknown>
}

function neonClient(apiKey: string): NeonClient {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${NEON_API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      // Só o status: o corpo de erro pode ecoar parâmetros.
      throw new Error(
        `Neon API ${method} ${path.replace(/\?.*$/, '')}: HTTP ${String(response.status)}`,
      )
    }
    return response.json()
  }
  return { get: (path) => call('GET', path), post: (path, body) => call('POST', path, body) }
}

function field<T>(value: unknown, key: string, guard: (v: unknown) => v is T): T {
  const candidate = (value as Record<string, unknown> | null)?.[key]
  if (!guard(candidate)) {
    throw new Error(`resposta da Neon API sem "${key}"`)
  }
  return candidate
}

const isString = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isArray = (value: unknown): value is unknown[] => Array.isArray(value)

async function defaultBranchId(neon: NeonClient, projectId: string): Promise<string> {
  const branches = field(await neon.get(`/projects/${projectId}/branches`), 'branches', isArray)
  const primary = branches.find((branch) => (branch as { default?: unknown }).default === true)
  return field(primary, 'id', isString)
}

async function roleNames(
  neon: NeonClient,
  projectId: string,
  branchId: string,
): Promise<Set<string>> {
  const roles = field(
    await neon.get(`/projects/${projectId}/branches/${branchId}/roles`),
    'roles',
    isArray,
  )
  return new Set(roles.map((role) => field(role, 'name', isString)))
}

function secretNames(gh: string, environment: string): Set<string> {
  const output = execFileSync(gh, ['secret', 'list', '--env', environment, '--json', 'name'], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(output) as { name: string }[]
  return new Set(parsed.map(({ name }) => name))
}

async function connectionUri(
  neon: NeonClient,
  projectId: string,
  branchId: string,
  role: RoleName,
): Promise<string> {
  const query = new URLSearchParams({
    branch_id: branchId,
    database_name: DATABASE_NAME,
    role_name: role,
    pooled: 'true',
  })
  const uri = field(
    await neon.get(`/projects/${projectId}/connection_uri?${query.toString()}`),
    'uri',
    isString,
  )
  if (!uri.startsWith('postgresql://') || !uri.includes('-pooler.')) {
    throw new Error(`connection_uri inesperada para ${role} (esperada uma URL -pooler)`)
  }
  return uri
}

function setSecret(gh: string, target: SecretTarget, value: string): void {
  // Valor pelo stdin: nunca na linha de comando (visível em `ps`) nem no terminal.
  execFileSync(gh, ['secret', 'set', target.secret, '--env', target.environment], {
    input: value,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

/** Lê uma linha do terminal sem ecoar o que é digitado (a API key nunca aparece na tela). */
async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new CliGuardError('sem terminal interativo: defina NEON_API_KEY no ambiente')
  }
  process.stderr.write(question)
  const muted = new Writable({
    write: (_chunk, _encoding, callback) => {
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
  try {
    return (await new Promise<string>((resolve) => rl.question('', resolve))).trim()
  } finally {
    rl.close()
    process.stderr.write('\n')
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      env: { type: 'string' },
      project: { type: 'string' },
      'reset-password': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
  })
  const target = values.env
  if (target !== 'staging' && target !== 'production') {
    throw new CliGuardError('--env precisa ser staging ou production')
  }
  const projectId = values.project ?? process.env['NEON_PROJECT_ID']
  if (!projectId || !/^[a-z0-9-]{1,64}$/.test(projectId)) {
    throw new CliGuardError('informe o ID do projeto Neon (--project ou NEON_PROJECT_ID)')
  }
  const apiKey =
    process.env['NEON_API_KEY'] ??
    (await promptHidden(`API key do projeto Neon ${projectId} (${target}, não aparece na tela): `))
  if (!apiKey) {
    throw new CliGuardError('API key vazia')
  }
  const gh = findOnSafePath('gh')
  const neon = neonClient(apiKey)
  const branchId = await defaultBranchId(neon, projectId)
  const environments = new Set(
    Object.values(SECRET_TARGETS[target])
      .flat()
      .map(({ environment }) => environment),
  )
  const existingSecrets = new Map(
    [...environments].map((environment) => [environment, secretNames(gh, environment)]),
  )
  const plan = planRoles(
    target,
    await roleNames(neon, projectId, branchId),
    existingSecrets,
    values['reset-password'],
  )
  for (const line of describePlan(plan)) {
    console.log(`neon-roles (${target}): ${line}`)
  }
  if (values['dry-run']) {
    return
  }
  for (const { role, action, secrets } of plan) {
    if (action === 'create') {
      await neon.post(`/projects/${projectId}/branches/${branchId}/roles`, { role: { name: role } })
    } else if (action === 'reset') {
      await neon.post(
        `/projects/${projectId}/branches/${branchId}/roles/${role}/reset_password`,
        {},
      )
    }
    if (secrets.length === 0) {
      continue
    }
    const uri = await connectionUri(neon, projectId, branchId, role)
    for (const secret of secrets) {
      setSecret(gh, secret, uri)
      console.log(`neon-roles (${target}): ${secret.environment}/${secret.secret} gravado`)
    }
  }
  console.log(
    `neon-roles (${target}): pronto. A env var Sensitive DATABASE_URL do projeto Vercel (teko_app,` +
      ' -pooler) entra pelo vercel-env-sync na F7.',
  )
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'neon-roles falhou')
    exit(1)
  })
}
