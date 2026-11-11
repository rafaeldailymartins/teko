/**
 * Gera os segredos de desenvolvimento local (`pnpm dev:secrets`).
 *
 * - `apps/api/.env`: segredos da API (proxy assinado de dev, Better Auth, DATABASE_URL).
 * - `infra/local/.env`: interpolação do `infra/local/compose.yaml` (Postgres, JWS do Caddy, Langfuse).
 *
 * Regras:
 * - Segredo existente NUNCA é sobrescrito: só as chaves ausentes são acrescentadas.
 * - A única exceção é `DEV_STATIC_JWS`, que é um token derivado (não um segredo): ele é assinado
 *   de novo quando falta, expira em menos de 24 h ou não confere com o `DEV_PROXY_JWS_SECRET` atual.
 * - Nenhum valor é impresso; o script só lista os nomes das chaves criadas.
 * - Os arquivos precisam estar ignorados pelo git; caso contrário, o script aborta sem escrever.
 *
 * Uso: node scripts/dev-secrets.ts
 */
import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { exit } from 'node:process'

const repoRoot = resolve(import.meta.dirname, '..')
const apiEnvPath = join(repoRoot, 'apps', 'api', '.env')
const infraEnvPath = join(repoRoot, 'infra', 'local', '.env')

/** Origem do `next dev`; vai no claim `site_url`, como a Netlify faz com a URL do site. */
const DEV_SITE_URL = 'http://localhost:3000'
/** Validade do JWS estático do proxy de dev (7 dias). */
const JWS_TTL_SECONDS = 7 * 24 * 60 * 60
/** Renova o JWS quando faltar menos que isto para expirar. */
const JWS_RENEW_MARGIN_SECONDS = 24 * 60 * 60
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

function assertGitIgnored(path: string): void {
  const target = relative(repoRoot, path)
  try {
    // Sem --no-index: um .env já rastreado pelo git conta como "não ignorado" e aborta.
    execFileSync('git', ['check-ignore', '--quiet', '--', target], {
      cwd: repoRoot,
      stdio: 'ignore',
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

const base64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url')

const hmacSha256 = (secret: string, data: string): Buffer =>
  createHmac('sha256', secret).update(data).digest()

/** JWS HS256 com os mesmos claims do header `x-nf-sign` da Netlify, com `deploy_context=dev`. */
function signDevJws(secret: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({
      deploy_context: 'dev',
      exp: nowSeconds + JWS_TTL_SECONDS,
      iss: 'netlify',
      site_url: DEV_SITE_URL,
    }),
  )
  const signingInput = `${header}.${payload}`
  return `${signingInput}.${hmacSha256(secret, signingInput).toString('base64url')}`
}

function isJwsUsable(token: string | undefined, secret: string, nowSeconds: number): boolean {
  if (token === undefined) return false
  const [header, payload, signature] = token.split('.')
  if (header === undefined || payload === undefined || signature === undefined) return false
  const expected = hmacSha256(secret, `${header}.${payload}`)
  const received = Buffer.from(signature, 'base64url')
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown
    }
    return typeof claims.exp === 'number' && claims.exp - nowSeconds > JWS_RENEW_MARGIN_SECONDS
  } catch {
    return false
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
  for (const path of [apiEnvPath, infraEnvPath]) {
    if (!existsSync(dirname(path))) {
      console.error(`dev-secrets: diretório ${relative(repoRoot, dirname(path))} não existe.`)
      exit(1)
    }
    assertGitIgnored(path)
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const api = readEnv(apiEnvPath)
  const infra = readEnv(infraEnvPath)

  // infra/local/.env: fonte de verdade da senha do Postgres e da porta publicada.
  const infraPlan: Plan = {
    path: infraEnvPath,
    header:
      '# Gerado por `pnpm dev:secrets` (fora do git). Segredos só de desenvolvimento local.\n' +
      '# Segredos existentes nunca são sobrescritos; DEV_STATIC_JWS é renovado ao expirar.',
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

  // apps/api/.env: fonte de verdade do segredo do proxy assinado de dev.
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
      ['DEV_PROXY_JWS_SECRET', () => hex(32)],
      ['BETTER_AUTH_SECRET', () => hex(32)],
      ['LANGFUSE_BASE_URL', () => 'http://localhost:3100'],
      ['LANGFUSE_PUBLIC_KEY', () => infraValue('LANGFUSE_INIT_PROJECT_PUBLIC_KEY')],
      ['LANGFUSE_SECRET_KEY', () => infraValue('LANGFUSE_INIT_PROJECT_SECRET_KEY')],
    ]),
  }

  const proxySecret =
    api.entries.get('DEV_PROXY_JWS_SECRET') ??
    apiPlan.additions.find(([key]) => key === 'DEV_PROXY_JWS_SECRET')?.[1]
  if (proxySecret === undefined) throw new Error('dev-secrets: DEV_PROXY_JWS_SECRET ausente')

  const infraReplacements = new Map<string, string>()
  let jwsRenewed = false
  if (!isJwsUsable(infra.entries.get('DEV_STATIC_JWS'), proxySecret, nowSeconds)) {
    const token = signDevJws(proxySecret, nowSeconds)
    if (infra.entries.has('DEV_STATIC_JWS')) infraReplacements.set('DEV_STATIC_JWS', token)
    else infraPlan.additions.push(['DEV_STATIC_JWS', token])
    jwsRenewed = true
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
  report(infraPlan, applyPlan(infraPlan, infra.content, infraReplacements))
  if (jwsRenewed) {
    console.log(
      'dev-secrets: DEV_STATIC_JWS assinado (validade de 7 dias). ' +
        'Recrie o proxy: docker compose -f infra/local/compose.yaml up -d',
    )
  }
}

main()
