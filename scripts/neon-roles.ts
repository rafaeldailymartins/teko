/**
 * Cria os roles de login do Tekó num projeto Neon **por SQL, como o owner**, e grava as URLs de
 * conexão como segredos dos GitHub Environments (e a `DATABASE_URL` Sensitive da Vercel), sem nunca
 * imprimir senha nem URL (ADR 0040; runbook `docs/runbooks/neon-roles.md`).
 *
 * Por que SQL e não a API do Neon: role criado pela API ou pelo Console vira membro do
 * `neon_superuser` (`CREATEROLE`, `CREATEDB`, `BYPASSRLS`, `pg_read_all_data`, `pg_write_all_data`),
 * o oposto do privilégio mínimo, e o owner não tem `ADMIN` sobre ele, então a migração de grants não
 * consegue gravar os timeouts (`ALTER ROLE ... SET`, Postgres 16+). Criado pelo owner com
 * `CREATE ROLE`, o role nasce só com o que os grants da migração lhe dão, e o owner fica com `ADMIN`.
 *
 * - `teko_app` (runtime e manutenção semanal) e `teko_watch` (source-watch), no branch padrão.
 * - Role ausente: `create`. Role da API (membro do `neon_superuser` ou sem `ADMIN` do owner):
 *   `recreate` (o owner revoga o que concedeu, a API do Neon apaga, o owner recria). Role certo:
 *   `keep`, a não ser com `--reset-password` ou com segredo faltando (a senha só existe no momento
 *   em que é gerada, então completar um segredo exige senha nova): `reset`.
 * - A senha é gerada aqui (40 caracteres, bem acima dos 60 bits que o Neon exige), vai ao Postgres
 *   por TLS e à URL `-pooler`, que segue pelo stdin para o `gh secret set` e, no `teko_app`, para o
 *   `vercel env add DATABASE_URL` (Vercel CLI isolado, com o login salvo do mantenedor).
 * - Os grants e os timeouts ficam nas migrações (`*_constraints-grants` e `*_regrant-login-roles`):
 *   role recriado depois da migração recebe os grants no próximo `drizzle-kit migrate`.
 *
 * Uso (o mantenedor, na própria máquina, com o `gh` autenticado e o Vercel CLI de
 * `tools/vercel-cli` instalado e logado):
 *   node scripts/neon-roles.ts --env staging --project <id-do-projeto> [--dry-run]
 *   node scripts/neon-roles.ts --env production --project <id-do-projeto> [--reset-password]
 *
 * A API key é do projeto (project-scoped). Sem `NEON_API_KEY` no ambiente, o script a pede no
 * terminal sem eco, e ela não fica no histórico do shell nem em disco. O ID do projeto não é
 * segredo (`--project` ou `NEON_PROJECT_ID`).
 */
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exit } from 'node:process'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { CliGuardError, findOnSafePath } from './lib/cli-guards.ts'

export const NEON_API = 'https://console.neon.tech/api/v2'
export const DATABASE_NAME = 'neondb'
export const OWNER_ROLE = 'neondb_owner'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Entrypoint do Vercel CLI instalado por `pnpm --dir tools/vercel-cli install --frozen-lockfile`. */
const VERCEL_CLI = join(
  REPO_ROOT,
  'tools',
  'vercel-cli',
  'node_modules',
  'vercel',
  'dist',
  'index.js',
)

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

/** Role cuja URL também é a `DATABASE_URL` Sensitive do projeto Vercel do ambiente. */
export const VERCEL_DATABASE_ROLE: RoleName = RoleName.App

/** Estado de um role no banco, lido como owner (`ROLE_STATE_SQL`). */
export interface RoleState {
  /** Membro (direto ou herdado) do `neon_superuser`: criado pela API ou pelo Console. */
  readonly neonSuperuser: boolean
  /** O owner tem `ADMIN OPTION` sobre o role (quem cria por SQL ganha; a API não dá). */
  readonly ownerAdmin: boolean
}

export type RoleAction = 'create' | 'recreate' | 'reset' | 'keep'

export interface RolePlan {
  readonly role: RoleName
  readonly action: RoleAction
  /** Por que a ação foi escolhida (para o plano impresso). */
  readonly reason: string
  /** Segredos a gravar: todos quando a senha muda, nenhum no `keep`. */
  readonly secrets: readonly SecretTarget[]
  /** Se a `DATABASE_URL` do projeto Vercel precisa da URL nova. */
  readonly vercel: boolean
}

/** Decide o que fazer com cada role, a partir do estado no banco e dos segredos existentes. */
export function planRoles(
  target: Target,
  states: ReadonlyMap<RoleName, RoleState>,
  existingSecrets: ReadonlyMap<string, ReadonlySet<string>>,
  resetPassword: boolean,
): RolePlan[] {
  return Object.values(RoleName).map((role) => {
    const targets = SECRET_TARGETS[target][role]
    const state = states.get(role)
    const missing = targets.filter(
      ({ environment, secret }) => !existingSecrets.get(environment)?.has(secret),
    )
    let action: RoleAction
    let reason: string
    if (state === undefined) {
      action = 'create'
      reason = 'não existe'
    } else if (state.neonSuperuser || !state.ownerAdmin) {
      action = 'recreate'
      reason = state.neonSuperuser
        ? 'membro do neon_superuser (criado pela API ou pelo Console)'
        : `o ${OWNER_ROLE} não tem ADMIN sobre ele`
    } else if (resetPassword) {
      action = 'reset'
      reason = '--reset-password'
    } else if (missing.length > 0) {
      action = 'reset'
      reason = 'segredo faltando (a senha só existe quando é gerada)'
    } else {
      action = 'keep'
      reason = 'criado por SQL, com os segredos gravados'
    }
    const changes = action !== 'keep'
    return {
      role,
      action,
      reason,
      secrets: changes ? targets : [],
      vercel: changes && role === VERCEL_DATABASE_ROLE,
    }
  })
}

export function describePlan(plan: readonly RolePlan[], target: Target): string[] {
  return plan.map(({ role, action, reason, secrets, vercel }) => {
    const destinations = secrets.map(({ environment, secret }) => `${environment}/${secret}`)
    if (vercel) {
      destinations.push(`vercel(${target})/DATABASE_URL`)
    }
    return `${role}: ${action} (${reason}); destinos: ${destinations.join(', ') || 'nenhum'}`
  })
}

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
/** Só símbolos que não precisam de escape numa URL nem num literal SQL. */
const SYMBOLS = '-_'
const PASSWORD_ALPHABET = LOWER + UPPER + DIGITS + SYMBOLS
export const PASSWORD_LENGTH = 40

/**
 * Senha aleatória de 40 caracteres (~238 bits) com minúscula, maiúscula, dígito e símbolo e sem o
 * mesmo caractere três vezes seguidas, as regras de composição que o Neon pede para 60 bits.
 */
export function generatePassword(pick: (max: number) => number = randomInt): string {
  for (;;) {
    let password = ''
    for (let index = 0; index < PASSWORD_LENGTH; index += 1) {
      password += PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)]
    }
    const classes = [LOWER, UPPER, DIGITS, SYMBOLS].every((set) =>
      [...password].some((char) => set.includes(char)),
    )
    if (classes && !/(.)\1\1/.test(password)) {
      return password
    }
  }
}

/** Identificador SQL entre aspas duplas (os nomes de role vêm de `RoleName`, mas sem confiar nisso). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

/** Literal SQL entre aspas simples (a senha não tem aspas, mas sem confiar nisso). */
export function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Estado dos roles de login, lido como owner. `$1`: os nomes. */
export const ROLE_STATE_SQL = `
SELECT r.rolname,
  EXISTS (
    SELECT 1 FROM pg_roles s
    WHERE s.rolname = 'neon_superuser' AND pg_has_role(r.oid, s.oid, 'MEMBER')
  ) AS neon_superuser,
  EXISTS (
    SELECT 1 FROM pg_auth_members m
    WHERE m.roleid = r.oid AND m.member = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      AND m.admin_option
  ) AS owner_admin
FROM pg_roles r
WHERE r.rolname = ANY($1)`

/** Esquemas onde as migrações concedem algo aos roles de login. */
export const GRANT_SCHEMAS = ['app', 'auth', 'corpus'] as const

/**
 * Revoga tudo o que o owner concedeu ao role (tabelas e colunas, sequências, esquemas, default
 * privileges e o banco), para a API do Neon conseguir apagá-lo. Esquema ausente é pulado.
 */
export function revokeSql(role: RoleName): string {
  const schemas = GRANT_SCHEMAS.map((schema) => quoteLiteral(schema)).join(', ')
  const name = quoteLiteral(role)
  return `DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[${schemas}] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', s, ${name});
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', s, ${name});
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', s, ${name});
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', s, ${name});
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', s, ${name});
    END IF;
  END LOOP;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I', current_database(), ${name});
END
$$`
}

export function createRoleSql(role: RoleName, password: string): string {
  return `CREATE ROLE ${quoteIdent(role)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`
}

export function resetPasswordSql(role: RoleName, password: string): string {
  return `ALTER ROLE ${quoteIdent(role)} WITH PASSWORD ${quoteLiteral(password)}`
}

/** A URL `-pooler` do owner com o usuário e a senha do role (host, banco e parâmetros iguais). */
export function withCredentials(ownerPoolerUri: string, role: RoleName, password: string): string {
  const url = new URL(ownerPoolerUri)
  if (url.protocol !== 'postgresql:' || !url.hostname.includes('-pooler.')) {
    throw new Error('connection_uri do owner inesperada (esperada uma URL postgresql:// -pooler)')
  }
  url.username = encodeURIComponent(role)
  url.password = encodeURIComponent(password)
  return url.toString()
}

interface NeonClient {
  get(path: string): Promise<unknown>
  delete(path: string): Promise<unknown>
}

function neonClient(apiKey: string): NeonClient {
  const call = async (method: string, path: string): Promise<unknown> => {
    const response = await fetch(`${NEON_API}${path}`, {
      method,
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    })
    if (!response.ok) {
      // Só o status: o corpo de erro pode ecoar parâmetros.
      throw new Error(
        `Neon API ${method} ${path.split('?')[0] ?? path}: HTTP ${String(response.status)}`,
      )
    }
    return response.json()
  }
  return { get: (path) => call('GET', path), delete: (path) => call('DELETE', path) }
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

async function ownerUri(
  neon: NeonClient,
  projectId: string,
  branchId: string,
  pooled: boolean,
): Promise<string> {
  const query = new URLSearchParams({
    branch_id: branchId,
    database_name: DATABASE_NAME,
    role_name: OWNER_ROLE,
    pooled: String(pooled),
  })
  return field(
    await neon.get(`/projects/${projectId}/connection_uri?${query.toString()}`),
    'uri',
    isString,
  )
}

async function readStates(client: pg.Client): Promise<Map<RoleName, RoleState>> {
  const { rows } = await client.query<{
    rolname: RoleName
    neon_superuser: boolean
    owner_admin: boolean
  }>(ROLE_STATE_SQL, [Object.values(RoleName)])
  return new Map(
    rows.map((row) => [
      row.rolname,
      { neonSuperuser: row.neon_superuser, ownerAdmin: row.owner_admin },
    ]),
  )
}

/** A API do Neon apaga o role por uma operação assíncrona: espera ele sumir do `pg_roles`. */
async function waitUntilDropped(client: pg.Client, role: RoleName): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])
    if (rowCount === 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`${role}: a API do Neon não apagou o role em 2 minutos`)
}

function secretNames(gh: string, environment: string): Set<string> {
  const output = execFileSync(gh, ['secret', 'list', '--env', environment, '--json', 'name'], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(output) as { name: string }[]
  return new Set(parsed.map(({ name }) => name))
}

function setSecret(gh: string, target: SecretTarget, value: string): void {
  // Valor pelo stdin: nunca na linha de comando (visível em `ps`) nem no terminal.
  execFileSync(gh, ['secret', 'set', target.secret, '--env', target.environment], {
    input: value,
    stdio: ['pipe', 'ignore', 'inherit'],
  })
}

function ghVariable(gh: string, name: string, environment: string): string {
  const value = execFileSync(gh, ['variable', 'get', name, '--env', environment], {
    encoding: 'utf8',
  }).trim()
  if (value === '') {
    throw new CliGuardError(`variável ${name} vazia no environment ${environment}`)
  }
  return value
}

/** `DATABASE_URL` Sensitive do projeto Vercel do ambiente, pelo stdin do Vercel CLI isolado. */
function setVercelDatabaseUrl(gh: string, target: Target, value: string): void {
  if (!existsSync(VERCEL_CLI)) {
    throw new CliGuardError(
      'Vercel CLI ausente: rode pnpm --dir tools/vercel-cli install --frozen-lockfile antes',
    )
  }
  // O environment do GitHub tem o mesmo nome do ambiente e guarda os IDs (não são segredo).
  const project = ghVariable(gh, 'VERCEL_PROJECT_ID', target)
  const scope = ghVariable(gh, 'VERCEL_ORG_ID', target)
  execFileSync(
    process.execPath,
    [
      VERCEL_CLI,
      'env',
      'add',
      'DATABASE_URL',
      'production',
      '--sensitive',
      '--force',
      '--project',
      project,
      '--scope',
      scope,
    ],
    { input: value, stdio: ['pipe', 'ignore', 'inherit'] },
  )
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
  const log = (line: string) => console.log(`neon-roles (${target}): ${line}`)
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
  // Conexão direta (sem -pooler): CREATE/ALTER ROLE e o bloco de REVOKE.
  const client = new pg.Client({
    connectionString: await ownerUri(neon, projectId, branchId, false),
  })
  await client.connect()
  try {
    const plan = planRoles(
      target,
      await readStates(client),
      existingSecrets,
      values['reset-password'],
    )
    for (const line of describePlan(plan, target)) {
      log(line)
    }
    if (values['dry-run']) {
      return
    }
    const poolerUri = await ownerUri(neon, projectId, branchId, true)
    for (const { role, action, secrets, vercel } of plan) {
      if (action === 'keep') {
        continue
      }
      if (action === 'recreate') {
        await client.query(revokeSql(role))
        await neon.delete(`/projects/${projectId}/branches/${branchId}/roles/${role}`)
        await waitUntilDropped(client, role)
        log(`${role}: o role da API foi apagado`)
      }
      const password = generatePassword()
      await client.query(
        action === 'reset' ? resetPasswordSql(role, password) : createRoleSql(role, password),
      )
      log(`${role}: ${action === 'reset' ? 'senha trocada' : 'criado por SQL'}`)
      const uri = withCredentials(poolerUri, role, password)
      for (const secret of secrets) {
        setSecret(gh, secret, uri)
        log(`${secret.environment}/${secret.secret} gravado`)
      }
      if (vercel) {
        setVercelDatabaseUrl(gh, target, uri)
        log('DATABASE_URL (Sensitive) gravada no projeto Vercel')
      }
    }
    log(
      'pronto. Os grants e os timeouts vêm do próximo drizzle-kit migrate (deploy.yml); role ' +
        'recriado fica sem acesso até lá.',
    )
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'neon-roles falhou')
    exit(1)
  })
}
