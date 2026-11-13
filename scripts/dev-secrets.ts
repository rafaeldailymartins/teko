/**
 * Gera os segredos de desenvolvimento local (`pnpm dev:secrets`).
 *
 * - `apps/api/.env`: segredos da API (Better Auth, DATABASE_URL) e o provedor de embeddings local
 *   (fake sobre a fixture).
 * - `infra/local/.env`: interpolação do `infra/local/compose.yaml` (Postgres e Langfuse).
 *
 * Regras:
 * - Segredo existente NUNCA é sobrescrito: só as chaves ausentes são acrescentadas.
 * - Nenhum valor é impresso; o script só lista os nomes das chaves criadas.
 * - Os arquivos precisam estar ignorados pelo git; caso contrário, o script aborta sem escrever.
 *
 * Uso: node scripts/dev-secrets.ts
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { exit } from 'node:process'
import { CliGuardError, findOnSafePath } from './lib/cli-guards.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const apiEnvPath = join(repoRoot, 'apps', 'api', '.env')
const infraEnvPath = join(repoRoot, 'infra', 'local', '.env')

/** Origem do `next dev`, que repassa `/api/*` para a API (web e API na mesma origem, ADR 0029). */
const DEV_SITE_URL = 'http://localhost:3000'
const DEFAULT_PG_PORT = '5432'

const hex = (bytes: number): string => randomBytes(bytes).toString('hex')

type EnvEntries = Map<string, string>

function parseEnv(content: string): EnvEntries {
  const entries: EnvEntries = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line
      .slice(0, separator)
      .replace(/^export\s+/, '')
      .trim()
    let value = line.slice(separator + 1).trim()
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1)
    entries.set(key, value)
  }
  return entries
}

function readEnv(path: string): { content: string; entries: EnvEntries } {
  const content = existsSync(path) ? readFileSync(path, 'utf8') : ''
  return { content, entries: parseEnv(content) }
}

/**
 * Caminho absoluto do git, procurado só em diretórios absolutos e protegidos do PATH: um nome
 * solto deixaria o sistema escolher o binário (no Windows, inclusive um `git.exe` plantado no cwd).
 * Sem git confiável, a consulta é pulada com aviso, como antes quando o git faltava.
 */
function trustedGit(): string | undefined {
  try {
    return findOnSafePath('git')
  } catch (error) {
    if (error instanceof CliGuardError) {
      return undefined
    }
    throw error
  }
}

function assertGitIgnored(path: string, git: string | undefined): void {
  const target = relative(repoRoot, path)
  if (git === undefined) {
    console.warn(`dev-secrets: git não encontrado no PATH para ${target}; seguindo assim mesmo.`)
    return
  }
  try {
    // Sem --no-index: um .env já rastreado pelo git conta como "não ignorado" e aborta.
    execFileSync(git, ['check-ignore', '--quiet', '--', target], {
      cwd: repoRoot,
      stdio: 'ignore',
      shell: false,
    })
  } catch (error) {
    const status = (error as { status?: number | null }).status
    if (status === 1) {
      console.error(`dev-secrets: ${target} não está no .gitignore; abortando sem escrever nada.`)
      exit(1)
    }
    console.warn(
      `dev-secrets: não foi possível consultar o git para ${target}; seguindo assim mesmo.`,
    )
  }
}

type Plan = { path: string; header: string; additions: Array<[string, string]> }

function missing(
  entries: EnvEntries,
  wanted: Array<[string, () => string]>,
): Array<[string, string]> {
  return wanted.filter(([key]) => !entries.has(key)).map(([key, make]) => [key, make()])
}

function applyPlan(plan: Plan, current: string, replacements: Map<string, string>): boolean {
  if (plan.additions.length === 0 && replacements.size === 0) return false
  let content = current
  for (const [key, value] of replacements) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`)
  }
  if (plan.additions.length > 0) {
    const prefix = content === '' ? `${plan.header}\n` : content.endsWith('\n') ? '' : '\n'
    content += `${prefix}${plan.additions.map(([key, value]) => `${key}=${value}`).join('\n')}\n`
  }
  // `mode` só vale para arquivo novo; no Windows o modo POSIX é ignorado.
  writeFileSync(plan.path, content, { encoding: 'utf8', mode: 0o600 })
  return true
}

function main(): void {
  const git = trustedGit()
  for (const path of [apiEnvPath, infraEnvPath]) {
    if (!existsSync(dirname(path))) {
      console.error(`dev-secrets: diretório ${relative(repoRoot, dirname(path))} não existe.`)
      exit(1)
    }
    assertGitIgnored(path, git)
  }

  const api = readEnv(apiEnvPath)
  const infra = readEnv(infraEnvPath)

  // infra/local/.env: fonte de verdade da senha do Postgres e da porta publicada.
  const infraPlan: Plan = {
    path: infraEnvPath,
    header:
      '# Gerado por `pnpm dev:secrets` (fora do git). Segredos só de desenvolvimento local.\n' +
      '# Segredos existentes nunca são sobrescritos.',
    additions: missing(infra.entries, [
      ['TEKO_PG_PORT', () => DEFAULT_PG_PORT],
      ['POSTGRES_PASSWORD', () => hex(24)],
      ['LANGFUSE_POSTGRES_PASSWORD', () => hex(24)],
      ['LANGFUSE_CLICKHOUSE_PASSWORD', () => hex(24)],
      ['LANGFUSE_REDIS_PASSWORD', () => hex(24)],
      ['LANGFUSE_MINIO_PASSWORD', () => hex(24)],
      ['LANGFUSE_NEXTAUTH_SECRET', () => hex(32)],
      ['LANGFUSE_SALT', () => hex(32)],
      ['LANGFUSE_ENCRYPTION_KEY', () => hex(32)],
      ['LANGFUSE_INIT_USER_PASSWORD', () => hex(16)],
      ['LANGFUSE_INIT_PROJECT_PUBLIC_KEY', () => `pk-lf-${hex(16)}`],
      ['LANGFUSE_INIT_PROJECT_SECRET_KEY', () => `sk-lf-${hex(16)}`],
    ]),
  }
  const infraValue = (key: string): string => {
    const value =
      infra.entries.get(key) ?? infraPlan.additions.find(([candidate]) => candidate === key)?.[1]
    if (value === undefined) throw new Error(`dev-secrets: chave ${key} ausente`)
    return value
  }

  // apps/api/.env: segredos e configuração local da API.
  const apiPlan: Plan = {
    path: apiEnvPath,
    header:
      '# Gerado por `pnpm dev:secrets` (fora do git). Segredos só de desenvolvimento local.\n' +
      '# Segredos existentes nunca são sobrescritos.',
    additions: missing(api.entries, [
      ['APP_ENV', () => 'development'],
      ['WEB_ORIGIN', () => DEV_SITE_URL],
      [
        'DATABASE_URL',
        () =>
          `postgres://teko:${infraValue('POSTGRES_PASSWORD')}@127.0.0.1:${infraValue('TEKO_PG_PORT')}/teko`,
      ],
      // Não são segredos: com DATABASE_URL, a API exige um provedor de embeddings, e o local usa o
      // fake sobre a fixture única (o `pnpm --filter @teko/api seed:fixtures` grava o corpus).
      ['EMBEDDINGS_PROVIDER', () => 'fake'],
      ['EMBEDDINGS_FIXTURE_PATH', () => 'test/fixtures/corpus/embeddings.json.gz'],
      ['BETTER_AUTH_SECRET', () => hex(32)],
      ['LANGFUSE_BASE_URL', () => 'http://localhost:3100'],
      ['LANGFUSE_PUBLIC_KEY', () => infraValue('LANGFUSE_INIT_PROJECT_PUBLIC_KEY')],
      ['LANGFUSE_SECRET_KEY', () => infraValue('LANGFUSE_INIT_PROJECT_SECRET_KEY')],
    ]),
  }

  const report = (plan: Plan, changed: boolean): void => {
    const target = relative(repoRoot, plan.path).replaceAll('\\', '/')
    const keys = plan.additions.map(([key]) => key)
    console.log(
      changed && keys.length > 0
        ? `dev-secrets: ${target}: criadas ${keys.join(', ')}`
        : `dev-secrets: ${target}: nenhuma chave nova`,
    )
  }

  const newPgPassword = infraPlan.additions.some(([key]) => key === 'POSTGRES_PASSWORD')
  if (newPgPassword && api.entries.has('DATABASE_URL')) {
    console.warn(
      'dev-secrets: POSTGRES_PASSWORD foi gerada agora, mas apps/api/.env já tinha DATABASE_URL. ' +
        'Remova DATABASE_URL de apps/api/.env e o volume do Postgres local, e rode de novo.',
    )
  }

  report(apiPlan, applyPlan(apiPlan, api.content, new Map()))
  report(infraPlan, applyPlan(infraPlan, infra.content, new Map()))
}

main()
