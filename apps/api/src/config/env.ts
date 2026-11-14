import { AppEnv, appEnvSchema, LlmProvider, llmProviderSchema } from '@teko/shared/contracts'
import { z } from 'zod'
import { gitShaSchema, releaseVersionSchema, UNKNOWN_GIT_SHA } from '#domain/shared/build-info.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * Variáveis de ambiente da API, validadas no boot (falha imediata, antes de abrir a porta).
 *
 * Asserções do plano já aplicáveis na F1:
 * - `APP_ENV=development` com `NODE_ENV=production` é proibido;
 * - staging e produção exigem `NODE_ENV=production`, `WEB_ORIGIN` em https e proíbem fakes
 *   (`LLM_PROVIDER=fake`, `EMBEDDINGS_PROVIDER=fake`) e saída `pino-pretty`;
 * - qualquer `*_BASE_URL`/`*_API_BASE` de provedor de modelo derruba o boot (os hosts dos
 *   provedores são fixos no código, nunca configuráveis);
 * - staging e produção exigem `RUNTIME_TARGET` explícito (`vercel` ou `render`): o padrão `node`
 *   (trustProxy na rede do Caddy, `x-request-id` aceito do proxy) só vale em development e ci, e
 *   `node` explícito é proibido ali. Sem isso, um sync de env esquecido subiria a produção no
 *   perfil do CI, pulando em silêncio as asserções da Vercel abaixo;
 * - a variável de sistema `VERCEL=1` (build e runtime da Vercel) exige `RUNTIME_TARGET=vercel`,
 *   em qualquer `APP_ENV`;
 * - com `RUNTIME_TARGET=vercel` em staging ou produção, o Node precisa ser `v24.*` e a variável de
 *   sistema `VERCEL_REGION` (presente em runtime) precisa ser `gru1`;
 * - o `trustProxy` nunca é um valor fixo para todas as plataformas: na Vercel é 1 salto, fixo no
 *   código (`TRUST_PROXY` é proibida); no Render vem do ensaio do Plano B (`TRUST_PROXY`
 *   obrigatória); no CI e local, a rede do Caddy (`DEFAULT_TRUST_PROXY`, só em development e ci);
 * - ingestão (F3): `NEON_API_KEY_STAGING` e `NEON_STAGING_PROJECT_ID` vêm aos pares;
 *   `BLOB_STORE=github-releases` exige o `GITHUB_TOKEN` (ADR 0030); e as credenciais da ingestão
 *   (inclusive o `GITHUB_TOKEN`) são proibidas na API publicada (`RUNTIME_TARGET` vercel ou
 *   render).
 *
 * As mensagens de erro citam só o nome da variável, nunca o valor (pode ser segredo).
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

/** Onde o mesmo `server.ts` está rodando (escolhe os adapters de `config/platform.ts`). */
export const RuntimeTarget = {
  /** Processo Node comum: `pnpm dev`, stack de CI, Docker local. */
  Node: 'node',
  /** Vercel Hobby (`tekoia`, `tekoia-staging`), uma Function Fastify em Fluid compute. */
  Vercel: 'vercel',
  /** Plano B: web service do Render Free. */
  Render: 'render',
} as const
export type RuntimeTarget = (typeof RuntimeTarget)[keyof typeof RuntimeTarget]

/** Provedores de embedding: Workers AI (BGE-M3) ou o fake de fixture (só development e ci). */
export const EmbeddingsProvider = {
  WorkersAi: 'workers-ai',
  Fake: 'fake',
} as const
export type EmbeddingsProvider = (typeof EmbeddingsProvider)[keyof typeof EmbeddingsProvider]

/** Backend dos artefatos da ingestão (ADR 0030): o GitHub Releases do repositório. */
const BlobStoreBackend = {
  GithubReleases: 'github-releases',
} as const

/** Reranker da busca (ADR 0027): `none` mantém a ordem do RRF. */
export const RerankerProvider = {
  None: 'none',
  WorkersAi: 'workers-ai',
} as const
export type RerankerProvider = (typeof RerankerProvider)[keyof typeof RerankerProvider]

/** Postgres: `postgresql://` ou `postgres://` (Neon `-pooler` com `teko_app` no runtime). */
const postgresUrlSchema = z
  .string()
  .trim()
  .refine((value) => /^postgres(?:ql)?:\/\//.test(value) && URL.canParse(value), {
    error: 'deve ser uma URL postgresql://',
  })

/**
 * Rede Docker do Caddy da stack de CI (`infra/ci`) e do proxy local: a sub-rede privada que o
 * compose fixa para o proxy, a única origem confiável de `X-Forwarded-For` nesses ambientes. É
 * configuração, não um endereço de serviço: vale só em development e ci (`CADDY_NETWORK_APP_ENVS`)
 * e é substituída por inteiro quando `TRUST_PROXY` está definida. Se a sub-rede do compose mudar,
 * mude aqui.
 */
const CADDY_DOCKER_NETWORK = { address: [172, 30, 0, 0], prefixLength: 24 } as const

/** `CADDY_DOCKER_NETWORK` em notação CIDR, o padrão do `trustProxy` em development e ci. */
export const DEFAULT_TRUST_PROXY = `${CADDY_DOCKER_NETWORK.address.join('.')}/${String(CADDY_DOCKER_NETWORK.prefixLength)}`

/**
 * Únicos ambientes em que `RUNTIME_TARGET` tem padrão (`node`) e em que o `trustProxy` pode cair
 * em `DEFAULT_TRUST_PROXY` (stack de CI, `pnpm dev`, Docker local).
 */
export const CADDY_NETWORK_APP_ENVS: ReadonlySet<AppEnv> = new Set([AppEnv.Development, AppEnv.Ci])

/** Valor da variável de sistema `VERCEL` no build e no runtime da Vercel. */
const VERCEL_SYSTEM_FLAG = '1'

/** Região de Functions dos dois projetos Vercel (mesma região AWS dos projetos Neon). */
export const VERCEL_FUNCTION_REGION = 'gru1'

/** Major do Node exigida em runtime na Vercel (`engines.node: "24.x"`, `.nvmrc`). */
const REQUIRED_NODE_MAJOR = 'v24.'

/** Duração máxima de uma invocação no Hobby (padrão e teto, inclusive stream). */
export const HOBBY_MAX_DURATION_S = 300

/** Abaixo do `stop_grace_period: 110s` da stack de CI, para sair antes do SIGKILL. */
export const DEFAULT_SHUTDOWN_GRACE_MS = 105_000
const MIN_SHUTDOWN_GRACE_MS = 30_000

/** Tempo para o proxy da frente ver o 503 do `/healthz` antes de a porta fechar. */
export const DEFAULT_DRAIN_DELAY_MS = 5000

/** Versão dos Termos em vigor quando nada é configurado. */
export const DEFAULT_TERMS_VERSION = '2026-11-14'

/**
 * Variáveis que o Better Auth lê sozinho do ambiente e que ligariam a telemetria dele (dados do
 * projeto para um terceiro): proibidas, com qualquer valor.
 */
const FORBIDDEN_LIBRARY_ENV = ['BETTER_AUTH_TELEMETRY', 'BETTER_AUTH_TELEMETRY_ENDPOINT'] as const

/** Nomes que redirecionariam um SDK de modelo para outro host. */
const PROVIDER_BASE_URL_PATTERN =
  /^(?:GOOGLE|GEMINI|GENAI|OPENAI|GROQ|CLOUDFLARE)\w*_(?:BASE_URL|API_BASE)$/

const PRODUCTION_LIKE: ReadonlySet<AppEnv> = new Set([AppEnv.Staging, AppEnv.Production])

const exactOriginSchema = z
  .url({ protocol: /^https?$/, error: 'deve ser uma URL http(s)' })
  .refine((value) => URL.canParse(value) && new URL(value).origin === value, {
    error:
      'deve ser uma origem exata, sem caminho nem barra final (ex.: https://tekoia.vercel.app)',
  })

const trustProxyListSchema = z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()])).min(1)

/**
 * Número de saltos confiáveis (`1`) ou lista de IPs/CIDRs separados por vírgula. O Render usa o
 * formato que o ensaio do Plano B medir.
 */
const trustProxySchema = z
  .string()
  .trim()
  .transform((value): number | string[] =>
    /^\d+$/.test(value)
      ? Number(value)
      : value
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== ''),
  )
  .pipe(z.union([z.int().min(1).max(10), trustProxyListSchema]))

export type TrustProxy = z.output<typeof trustProxySchema>

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: appEnvSchema,
    HOST: z.string().trim().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    LOG_PRETTY: z.stringbool().default(false),
    WEB_ORIGIN: exactOriginSchema,
    APP_VERSION: releaseVersionSchema.default('0.0.0'),
    GIT_SHA: gitShaSchema.default(UNKNOWN_GIT_SHA),
    /** Sem `.default()`: o padrão `node` só é aplicado em development e ci (transform abaixo). */
    RUNTIME_TARGET: z.enum(RuntimeTarget).optional(),
    /** Variável de sistema da Vercel (`1` no build e no runtime); nunca defina à mão. */
    VERCEL: z.string().optional(),
    TRUST_PROXY: trustProxySchema.optional(),
    /** Variável de sistema da Vercel (só em runtime; falta no build com `--prebuilt`). */
    VERCEL_REGION: z.string().trim().min(1).optional(),
    /**
     * `maxDuration` da Function (`.vc-config.json` de `scripts/build-vercel-output.ts`, que o teste
     * do script confere contra `infra/vercel/env.*.json`). Obrigatória com `RUNTIME_TARGET=vercel`
     * e sem padrão: um padrão (o antigo era 300 s) divergiria em silêncio do `.vc-config.json`.
     */
    FUNCTION_MAX_DURATION_S: z.coerce.number().int().min(1).max(HOBBY_MAX_DURATION_S).optional(),
    /**
     * Export estático do web (`apps/web/out`) servido pela própria API, na mesma origem: só no
     * Plano B (Render; ADR 0029). Proibida com `RUNTIME_TARGET=vercel`, onde a CDN serve o export.
     */
    WEB_STATIC_DIR: z.string().trim().min(1).optional(),
    SHUTDOWN_GRACE_MS: z.coerce
      .number()
      .int()
      .min(MIN_SHUTDOWN_GRACE_MS)
      .max(600_000)
      .default(DEFAULT_SHUTDOWN_GRACE_MS),
    DRAIN_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(DEFAULT_DRAIN_DELAY_MS),
    /**
     * Cadeia de LLM: `gemini` (Gemini primário → Gemini de fallback → Groq), `groq` (só o Groq) ou
     * `fake` (development e ci). Sem valor, as rotas de pergunta respondem 503.
     */
    LLM_PROVIDER: llmProviderSchema.optional(),
    /** Chaves dos provedores (Sensitive na Vercel); hosts fixos no código. */
    GEMINI_API_KEY: z.string().trim().min(10).optional(),
    GROQ_API_KEY: z.string().trim().min(10).optional(),
    GEMINI_MODEL_PRIMARY: z.string().trim().min(1).default('gemini-3.6-flash'),
    GEMINI_MODEL_FALLBACK: z.string().trim().min(1).default('gemini-3.5-flash-lite'),
    GROQ_MODEL: z.string().trim().min(1).default('openai/gpt-oss-120b'),
    /** Kill switch: acerto do cache continua respondendo; o resto recebe 503 `service_paused`. */
    LLM_KILL_SWITCH: z.stringbool().default(false),
    /** Tetos diários do ambiente (`usage_daily`); os padrões são os da produção. */
    QUOTA_QUESTIONS_GLOBAL_DAILY: z.coerce.number().int().min(0).default(300),
    QUOTA_QUESTIONS_PER_USER_DAILY: z.coerce.number().int().min(0).default(30),
    QUOTA_NEURONS_DAILY: z.coerce.number().int().min(0).default(800),
    QUOTA_STREAM_SECONDS_DAILY: z.coerce.number().int().min(0).default(6000),
    /** Teto de cada stream (e da reserva de `stream_seconds`), em segundos; o plano usa 100. */
    STREAM_MAX_SECONDS: z.coerce.number().int().min(1).max(100).default(100),
    /** Validade do cache exato de respostas, em dias. */
    ANSWER_CACHE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    EMBEDDINGS_PROVIDER: z.enum(EmbeddingsProvider).optional(),
    /** Reranker da busca (ADR 0027); `workers-ai` usa as mesmas `CF_ACCOUNT_ID` e `CF_AI_TOKEN`. */
    RERANKER_PROVIDER: z.enum(RerankerProvider).default(RerankerProvider.None),
    /**
     * Postgres do runtime (Neon `-pooler`, role `teko_app`). Opcional até a F4, quando as rotas de
     * pergunta passam a exigir o banco; sem ela, o container não monta a busca.
     */
    DATABASE_URL: postgresUrlSchema.optional(),
    /**
     * Segredo do Better Auth (assina cookies de sessão e tokens). Obrigatório em staging e
     * produção com banco; sem ele (CLI, evals, testes sem sessão), `/api/auth/*` e as rotas que
     * exigem sessão respondem 503.
     */
    BETTER_AUTH_SECRET: z.string().min(32, { error: 'deve ter ao menos 32 caracteres' }).optional(),
    /** OAuth apps por ambiente (callbacks em `<WEB_ORIGIN>/api/auth/callback/{github,google}`). */
    GITHUB_CLIENT_ID: z.string().trim().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
    /** Versão vigente dos Termos: o onboarding só aceita esta, e uma versão nova pede novo aceite. */
    TERMS_VERSION: z
      .string()
      .regex(/^[0-9A-Za-z.-]{1,32}$/)
      .default(DEFAULT_TERMS_VERSION),
    /** Conexões do pool por instância (Fluid compute: várias invocações na mesma instância; plano: 3). */
    DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(3),
    /** Fixture de embeddings do fake (`apps/api/test/fixtures/corpus/embeddings.json.gz`). */
    EMBEDDINGS_FIXTURE_PATH: z.string().trim().min(1).optional(),
    /** Fake em modo strict: um texto fora da fixture falha (evals e e2e). */
    EMBEDDINGS_FAKE_STRICT: z.stringbool().default(false),
    /** Conta e token (escopo Workers AI) do Cloudflare, para `EMBEDDINGS_PROVIDER=workers-ai`. */
    CF_ACCOUNT_ID: z
      .string()
      .regex(/^[0-9a-f]{32}$/, { error: 'deve ter 32 dígitos hex' })
      .optional(),
    CF_AI_TOKEN: z.string().min(20).optional(),
    /**
     * Requisições por minuto por usuário (ou por IP, sem sessão) nas rotas com rate limit da
     * aplicação (`/api/v1/provisions*`, histórico e `/me/export`), contadas em Postgres.
     */
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(60),
    /** Maior RRF abaixo do qual a pergunta é recusada como `no_evidence` sem chamar o LLM. */
    MIN_EVIDENCE_RRF: z.coerce.number().min(0).max(1).default(0),
    // --- Ingestão (CLI `ingest`, `snapshot`, `eval-fixture`; só no Actions e localmente) -------
    /**
     * Onde ficam os artefatos da ingestão (ADR 0030). Com `github-releases` (o que os workflows
     * declaram), o `GITHUB_TOKEN` é obrigatório: um run no Actions nunca cai, sem aviso, no store
     * em memória. Sem valor, o GitHub Releases quando há token, e a memória quando não há (local).
     */
    BLOB_STORE: z.enum(BlobStoreBackend).optional(),
    /** Token do job (`github.token`), com `contents: write` só nos jobs que gravam artefatos. */
    GITHUB_TOKEN: z.string().trim().min(20).optional(),
    /** `owner/repo` dos releases (variável padrão do Actions). */
    GITHUB_REPOSITORY: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, { error: 'deve ser owner/repo' })
      .optional(),
    /** Orçamento diário de neurons da ingestão (Workers AI Free: 10.000/dia na conta; plano: 8.000). */
    EMBED_NEURON_BUDGET: z.coerce.number().int().min(0).max(10_000).default(8000),
    /** Guarda de tamanho da ingestão, em bytes (padrão 800 MB; o Neon Free tem 1 GB). */
    INGEST_MAX_DB_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(800 * 1024 * 1024),
    /**
     * Bytes por chunk novo na guarda prospectiva (`tamanho + chunksNovos × isto > limite` aborta
     * antes dos embeddings); padrão: os ≈ 10,6 KB medidos no staging.
     */
    INGEST_BYTES_PER_CHUNK: z.coerce.number().int().positive().default(10_854),
    /** API do Neon para medir os CU-s do run de ingestão no staging (sem elas, `cu_seconds` nulo). */
    NEON_API_KEY_STAGING: z.string().trim().min(20).optional(),
    NEON_STAGING_PROJECT_ID: z
      .string()
      .regex(/^[a-z0-9-]{1,64}$/, { error: 'ID de projeto Neon inválido' })
      .optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string): void => {
      ctx.addIssue({ code: 'custom', path: [path], message })
    }

    if (env.APP_ENV === AppEnv.Development && env.NODE_ENV === 'production') {
      issue('NODE_ENV', 'APP_ENV=development com NODE_ENV=production é proibido')
    }
    if (env.DRAIN_DELAY_MS >= env.SHUTDOWN_GRACE_MS) {
      issue('DRAIN_DELAY_MS', 'deve ser menor que SHUTDOWN_GRACE_MS')
    }
    if (env.RUNTIME_TARGET === RuntimeTarget.Vercel && env.TRUST_PROXY !== undefined) {
      issue('TRUST_PROXY', 'não se aplica com RUNTIME_TARGET=vercel (1 salto, fixo no código)')
    }
    if (env.RUNTIME_TARGET === RuntimeTarget.Vercel && env.FUNCTION_MAX_DURATION_S === undefined) {
      issue(
        'FUNCTION_MAX_DURATION_S',
        'obrigatória com RUNTIME_TARGET=vercel (o maxDuration do .vc-config.json)',
      )
    }
    if (env.RUNTIME_TARGET === RuntimeTarget.Vercel && env.WEB_STATIC_DIR !== undefined) {
      issue('WEB_STATIC_DIR', 'não se aplica com RUNTIME_TARGET=vercel (a CDN serve o export)')
    }
    if (env.RUNTIME_TARGET === RuntimeTarget.Render && env.TRUST_PROXY === undefined) {
      issue('TRUST_PROXY', 'obrigatória com RUNTIME_TARGET=render (valor medido no ensaio)')
    }
    if (env.VERCEL === VERCEL_SYSTEM_FLAG && env.RUNTIME_TARGET !== RuntimeTarget.Vercel) {
      issue(
        'RUNTIME_TARGET',
        'a variável de sistema VERCEL=1 está presente; exige RUNTIME_TARGET=vercel',
      )
    }
    if (env.LLM_PROVIDER === LlmProvider.Gemini) {
      for (const name of ['GEMINI_API_KEY', 'GROQ_API_KEY'] as const) {
        if (env[name] === undefined) {
          issue(name, `obrigatória com LLM_PROVIDER=gemini (a cadeia termina no Groq)`)
        }
      }
    }
    if (env.LLM_PROVIDER === LlmProvider.Groq && env.GROQ_API_KEY === undefined) {
      issue('GROQ_API_KEY', 'obrigatória com LLM_PROVIDER=groq')
    }
    if (env.DATABASE_URL !== undefined && env.EMBEDDINGS_PROVIDER === undefined) {
      issue('EMBEDDINGS_PROVIDER', 'obrigatória com DATABASE_URL (a busca precisa de embeddings)')
    }
    if (
      env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.Fake &&
      env.EMBEDDINGS_FIXTURE_PATH === undefined
    ) {
      issue('EMBEDDINGS_FIXTURE_PATH', 'obrigatória com EMBEDDINGS_PROVIDER=fake')
    }
    for (const [name, provider] of [
      ['EMBEDDINGS_PROVIDER', env.EMBEDDINGS_PROVIDER],
      ['RERANKER_PROVIDER', env.RERANKER_PROVIDER],
    ] as const) {
      if (provider !== 'workers-ai') {
        continue
      }
      if (env.CF_ACCOUNT_ID === undefined) {
        issue('CF_ACCOUNT_ID', `obrigatória com ${name}=workers-ai`)
      }
      if (env.CF_AI_TOKEN === undefined) {
        issue('CF_AI_TOKEN', `obrigatória com ${name}=workers-ai`)
      }
    }
    if (env.BLOB_STORE === BlobStoreBackend.GithubReleases && env.GITHUB_TOKEN === undefined) {
      issue('GITHUB_TOKEN', 'obrigatória com BLOB_STORE=github-releases')
    }
    if (env.GITHUB_TOKEN !== undefined && env.GITHUB_REPOSITORY === undefined) {
      issue('GITHUB_REPOSITORY', 'obrigatória com GITHUB_TOKEN (owner/repo dos releases)')
    }
    for (const [id, secret] of [
      ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    ] as const) {
      if ((env[id] === undefined) !== (env[secret] === undefined)) {
        issue(env[id] === undefined ? id : secret, `${id} e ${secret} vêm juntas`)
      }
    }
    if ((env.NEON_API_KEY_STAGING === undefined) !== (env.NEON_STAGING_PROJECT_ID === undefined)) {
      issue(
        env.NEON_API_KEY_STAGING === undefined ? 'NEON_API_KEY_STAGING' : 'NEON_STAGING_PROJECT_ID',
        'NEON_API_KEY_STAGING e NEON_STAGING_PROJECT_ID vêm juntas (medição de CU-h da ingestão)',
      )
    }
    if (
      env.RUNTIME_TARGET === RuntimeTarget.Vercel ||
      env.RUNTIME_TARGET === RuntimeTarget.Render
    ) {
      // A API publicada nunca recebe credenciais da ingestão (artefatos e API do Neon ficam no
      // Actions).
      for (const name of ['GITHUB_TOKEN', 'NEON_API_KEY_STAGING'] as const) {
        if (env[name] !== undefined) {
          issue(
            name,
            `proibida com RUNTIME_TARGET=${env.RUNTIME_TARGET} (só a CLI de ingestão usa)`,
          )
        }
      }
    }
    if (!PRODUCTION_LIKE.has(env.APP_ENV)) {
      return
    }
    if (env.NODE_ENV !== 'production') {
      issue('NODE_ENV', `APP_ENV=${env.APP_ENV} exige NODE_ENV=production`)
    }
    if (env.RUNTIME_TARGET === undefined) {
      issue(
        'RUNTIME_TARGET',
        `obrigatória com APP_ENV=${env.APP_ENV} (o padrão node só vale em development e ci)`,
      )
    } else if (env.RUNTIME_TARGET === RuntimeTarget.Node) {
      issue(
        'RUNTIME_TARGET',
        `node é proibido com APP_ENV=${env.APP_ENV} (staging e produção rodam na Vercel ou no Render)`,
      )
    }
    if (!env.WEB_ORIGIN.startsWith('https://')) {
      issue('WEB_ORIGIN', `APP_ENV=${env.APP_ENV} exige origem https`)
    }
    if (env.LOG_PRETTY) {
      issue('LOG_PRETTY', `APP_ENV=${env.APP_ENV} não usa pino-pretty (devDependency)`)
    }
    if (env.LLM_PROVIDER === LlmProvider.Fake) {
      issue('LLM_PROVIDER', `fake é proibido com APP_ENV=${env.APP_ENV}`)
    }
    if (env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.Fake) {
      issue('EMBEDDINGS_PROVIDER', `fake é proibido com APP_ENV=${env.APP_ENV}`)
    }
    if (env.DATABASE_URL !== undefined) {
      if (env.LLM_PROVIDER === undefined) {
        issue('LLM_PROVIDER', `obrigatória com APP_ENV=${env.APP_ENV} e DATABASE_URL`)
      }
      // A API publicada com banco sempre tem login: segredo e os dois OAuth apps.
      for (const name of ['BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GOOGLE_CLIENT_ID'] as const) {
        if (env[name] === undefined) {
          issue(name, `obrigatória com APP_ENV=${env.APP_ENV} e DATABASE_URL`)
        }
      }
    }
    if (
      env.RUNTIME_TARGET === RuntimeTarget.Vercel &&
      env.VERCEL_REGION !== VERCEL_FUNCTION_REGION
    ) {
      issue('VERCEL_REGION', `RUNTIME_TARGET=vercel em ${env.APP_ENV} exige a região gru1`)
    }
  })
  // Só roda sem issues: em staging/produção a falta de RUNTIME_TARGET já derrubou o parse acima.
  .transform(({ RUNTIME_TARGET, ...env }) => ({
    ...env,
    RUNTIME_TARGET: RUNTIME_TARGET ?? RuntimeTarget.Node,
  }))

export type Env = z.output<typeof envSchema>

export class EnvValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(
      `Configuração inválida (variáveis de ambiente):\n${problems.map((p) => `- ${p}`).join('\n')}`,
    )
    this.name = 'EnvValidationError'
    this.problems = problems
  }
}

function forbiddenBaseUrlProblems(source: Readonly<Record<string, string | undefined>>): string[] {
  const baseUrls = Object.keys(source)
    .filter((key) => PROVIDER_BASE_URL_PATTERN.test(key) && source[key] !== undefined)
    .sort(compareCodeUnits)
    .map((key) => `${key}: proibida (o host do provedor é fixo no código)`)
  const library = FORBIDDEN_LIBRARY_ENV.filter((key) => source[key] !== undefined).map(
    (key) => `${key}: proibida (telemetria do Better Auth fica desligada)`,
  )
  return [...baseUrls, ...library]
}

/** Fatos do processo que entram nas asserções de boot (injetáveis nos testes). */
export interface RuntimeFacts {
  /** `process.version` (a Vercel rola minor e patch sem aviso; a major é conferida). */
  readonly nodeVersion: string
}

function runtimeProblems(env: Env, runtime: RuntimeFacts): string[] {
  const vercelInProductionLike =
    env.RUNTIME_TARGET === RuntimeTarget.Vercel && PRODUCTION_LIKE.has(env.APP_ENV)
  return vercelInProductionLike && !runtime.nodeVersion.startsWith(REQUIRED_NODE_MAJOR)
    ? [`(runtime): RUNTIME_TARGET=vercel em ${env.APP_ENV} exige Node 24 (engines.node 24.x)`]
    : []
}

/** Fatos do processo atual (padrão de `parseEnv` fora dos testes). */
function processRuntimeFacts(): RuntimeFacts {
  return { nodeVersion: process.version }
}

/** Valida o ambiente. Lança `EnvValidationError` listando todas as variáveis com problema. */
export function parseEnv(
  source: Readonly<Record<string, string | undefined>>,
  runtime: RuntimeFacts = processRuntimeFacts(),
): Env {
  const result = envSchema.safeParse(source)
  const problems = forbiddenBaseUrlProblems(source)
  if (!result.success) {
    problems.push(
      ...result.error.issues.map(
        (issue) => `${issue.path.map(String).join('.') || '(env)'}: ${issue.message}`,
      ),
    )
  } else {
    problems.push(...runtimeProblems(result.data, runtime))
  }
  if (problems.length > 0 || !result.success) {
    throw new EnvValidationError(problems)
  }
  return result.data
}

export function loadEnv(): Env {
  return parseEnv(process.env)
}

/**
 * A CLI (`src/cli.ts`) não serve HTTP: `APP_ENV` e `WEB_ORIGIN` ganham o padrão de
 * desenvolvimento quando não vêm do ambiente, só para o mesmo schema validar o resto.
 */
const CLI_ENV_DEFAULTS = {
  APP_ENV: AppEnv.Development,
  WEB_ORIGIN: 'http://localhost:3000',
} as const

export function loadCliEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Env {
  return parseEnv({ ...CLI_ENV_DEFAULTS, ...source })
}

/**
 * Ambiente do `coverage-mark` (job `mark-coverage`, environment `corpus-watch`): só as URLs do
 * role `teko_watch`, sem passar pelo schema da CLI (o job não tem `DATABASE_URL`).
 */
export function loadWatchEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<Record<'NEON_PROD_WATCH_URL' | 'NEON_STAGING_WATCH_URL', string | undefined>> {
  const { NEON_PROD_WATCH_URL, NEON_STAGING_WATCH_URL } = source
  return { NEON_PROD_WATCH_URL, NEON_STAGING_WATCH_URL }
}
