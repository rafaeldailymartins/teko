/**
 * Cliente mínimo da API REST da Vercel (`https://api.vercel.com`) para os scripts de deploy da F7
 * (`scripts/vercel-env-sync.ts`, `scripts/vercel-firewall.ts`) e para quem precisar ler ou mudar o
 * projeto pelo Actions (o guarda de uso do `ops.yml` reaproveita). Sem dependências: `fetch` do
 * Node 24.
 *
 * - Autenticação: `Authorization: Bearer <VERCEL_TOKEN>`; o `teamId` (`VERCEL_ORG_ID`) vai em toda
 *   chamada. No Hobby, todo token tem escopo da conta inteira; por isso cada uso tem um token
 *   próprio, guardado no environment do GitHub.
 * - Projetos: os ids são constantes por ambiente (`VERCEL_PROJECTS`, os mesmos do
 *   `infra/vercel/README.md`). `VERCEL_PROJECT_ID`, se vier no ambiente, precisa ser igual à
 *   constante do `--env` escolhido: um token de staging com o id de produção (ou o contrário) para
 *   antes de qualquer escrita.
 * - Erros: só o método, o caminho e o código da Vercel (`error.code`). O corpo pode repetir valores
 *   de env vars e nunca vai para o log.
 *
 * Testes em `scripts/lib/vercel-api.test.ts` (`pnpm test:scripts`).
 */

const VERCEL_API_ORIGIN = 'https://api.vercel.com'

const REQUEST_TIMEOUT_MS = 30_000

/** Ambientes de deploy: um projeto Vercel por ambiente (ADR 0029). */
export type DeployEnv = 'production' | 'staging'

export const DEPLOY_ENVS: readonly DeployEnv[] = ['production', 'staging']

export interface VercelProject {
  /** Nome do projeto (o `project` de `infra/vercel/env.<env>.json`). */
  readonly name: string
  readonly id: string
  /** Domínio canônico (`WEB_ORIGIN`). */
  readonly origin: string
}

export const VERCEL_PROJECTS: Readonly<Record<DeployEnv, VercelProject>> = {
  production: {
    name: 'tekoia',
    id: 'prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as',
    origin: 'https://tekoia.vercel.app',
  },
  staging: {
    name: 'tekoia-staging',
    id: 'prj_rgXwv6zcTTb1UPU1qkEMrAWu6hY5',
    origin: 'https://tekoia-staging.vercel.app',
  },
}

/** Valor de `--env` validado contra o conjunto constante (o argumento só serve de chave). */
export function parseDeployEnv(value: string | undefined): DeployEnv | undefined {
  return DEPLOY_ENVS.find((env) => env === value)
}

export class VercelApiError extends Error {
  override readonly name = 'VercelApiError'
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export class VercelConfigError extends Error {
  override readonly name = 'VercelConfigError'
}

type Env = Readonly<Record<string, string | undefined>>

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

const TEAM_ID = /^[A-Za-z0-9_-]{1,64}$/
const PROJECT_ID = /^prj_[A-Za-z0-9]{1,64}$/

export interface VercelCredentials {
  readonly token: string
  readonly teamId: string
  readonly project: VercelProject
}

/**
 * `VERCEL_TOKEN`, `VERCEL_ORG_ID` e o projeto do ambiente. Lança `VercelConfigError` com os nomes
 * do que falta (nunca os valores) ou se `VERCEL_PROJECT_ID` não for o projeto do ambiente.
 */
export function credentialsFromEnv(env: Env, deployEnv: DeployEnv): VercelCredentials {
  const token = value(env, 'VERCEL_TOKEN')
  const teamId = value(env, 'VERCEL_ORG_ID')
  const missing = [
    ...(token === undefined ? ['VERCEL_TOKEN'] : []),
    ...(teamId === undefined ? ['VERCEL_ORG_ID'] : []),
  ]
  if (token === undefined || teamId === undefined) {
    throw new VercelConfigError(`faltam ${missing.join(' e ')} no ambiente`)
  }
  if (!TEAM_ID.test(teamId)) {
    throw new VercelConfigError('VERCEL_ORG_ID fora do formato esperado')
  }
  const project = VERCEL_PROJECTS[deployEnv]
  const projectId = value(env, 'VERCEL_PROJECT_ID')
  if (projectId !== undefined && (!PROJECT_ID.test(projectId) || projectId !== project.id)) {
    throw new VercelConfigError(
      `VERCEL_PROJECT_ID não é o projeto ${project.name} (${project.id}); confira o environment do GitHub`,
    )
  }
  return { token, teamId, project }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  readonly query?: Readonly<Record<string, string>>
  readonly body?: unknown
}

/** Uma chamada à API; devolve o JSON da resposta (ou `null` sem corpo). */
export type VercelApi = (
  method: HttpMethod,
  path: string,
  options?: RequestOptions,
) => Promise<unknown>

function errorCode(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    const error: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'error') : undefined
    const code: unknown =
      typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
    return typeof code === 'string' && /^[\w.-]{1,80}$/.test(code) ? code : undefined
  } catch {
    return undefined
  }
}

/** Cliente com o token e o `teamId` em toda chamada; `path` sempre começa com `/`. */
export function createVercelApi(
  credentials: Pick<VercelCredentials, 'token' | 'teamId'>,
  doFetch: typeof fetch = fetch,
): VercelApi {
  return async (method, path, options = {}) => {
    if (!path.startsWith('/') || path.includes('//') || path.includes('..')) {
      throw new VercelConfigError(`caminho inválido: ${path}`)
    }
    const url = new URL(path, VERCEL_API_ORIGIN)
    for (const [key, val] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, val)
    }
    url.searchParams.set('teamId', credentials.teamId)
    const response = await doFetch(url, {
      method,
      headers: {
        authorization: `Bearer ${credentials.token}`,
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    if (!response.ok) {
      const code = errorCode(text)
      throw new VercelApiError(
        `${method} ${path} respondeu ${String(response.status)}${code === undefined ? '' : ` (${code})`}`,
        response.status,
      )
    }
    return text === '' ? null : (JSON.parse(text) as unknown)
  }
}

/** Confere que o id do ambiente é mesmo o projeto esperado (`GET /v9/projects/{id}`). */
export async function assertProject(api: VercelApi, project: VercelProject): Promise<void> {
  const body = await api('GET', `/v9/projects/${encodeURIComponent(project.id)}`)
  const name: unknown =
    typeof body === 'object' && body !== null ? Reflect.get(body, 'name') : undefined
  if (name !== project.name) {
    throw new VercelConfigError(
      `o projeto ${project.id} se chama ${JSON.stringify(name)}, não ${project.name}`,
    )
  }
}

/** Uma linha por chamada: quebra de linha vinda de erro ou resposta não forja comando do Actions. */
export function logLine(line: string): void {
  console.log(line.replaceAll(/[\r\n]/gu, ' '))
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
