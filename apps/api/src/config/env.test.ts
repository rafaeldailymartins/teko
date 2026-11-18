import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAIN_DELAY_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_TERMS_VERSION,
  DEFAULT_TRUST_PROXY,
  EnvValidationError,
  HOBBY_MAX_DURATION_S,
  langfuseSettings,
  loadCliEnv,
  loadMaintenanceEnv,
  loadWatchEnv,
  parseEnv as parseProcessEnv,
  type RuntimeFacts,
  VERCEL_FUNCTION_REGION,
} from './env.ts'

const DEV_ENV = { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' } as const

/** Produção mínima válida: a Vercel em gru1 (o Node vem injetado, `NODE_24`). */
const PROD_ENV = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  WEB_ORIGIN: 'https://tekoia.vercel.app',
  RUNTIME_TARGET: 'vercel',
  VERCEL_REGION: 'gru1',
  FUNCTION_MAX_DURATION_S: '120',
} as const

const NODE_24: RuntimeFacts = { nodeVersion: 'v24.12.0' }

/** `parseEnv` com o Node 24 injetado: os casos não dependem da versão de quem roda a suíte. */
function parseEnv(
  source: Readonly<Record<string, string | undefined>>,
  runtime: RuntimeFacts = NODE_24,
) {
  return parseProcessEnv(source, runtime)
}

function problemsOf(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseEnv(source)
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error.problems
    }
    throw error
  }
  throw new Error('parseEnv deveria ter falhado')
}

describe('erros no PostHog (F6, ADR 0037)', () => {
  it('sem a chave, os erros não saem', () => {
    expect(parseEnv(DEV_ENV).POSTHOG_PROJECT_KEY).toBeUndefined()
  })

  it('aceita a chave do projeto e recusa outra coisa sem repetir o valor', () => {
    const key = `phc_${'A1b2'.repeat(10)}`
    expect(parseEnv({ ...PROD_ENV, POSTHOG_PROJECT_KEY: ` ${key} ` }).POSTHOG_PROJECT_KEY).toBe(key)
    for (const value of ['phx_pessoal0123456789abcdef', 'phc_curta', `phc_${'a'.repeat(65)}`]) {
      expect(problemsOf({ ...DEV_ENV, POSTHOG_PROJECT_KEY: value })).toEqual([
        'POSTHOG_PROJECT_KEY: deve ser a chave do projeto (phc_…)',
      ])
    }
  })
})

describe('telemetria OTLP (F6)', () => {
  it('sem endpoint, sem exportação; métricas em cumulativo por padrão', () => {
    const env = parseEnv(DEV_ENV)
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined()
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toBeUndefined()
    expect(env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE).toBe('cumulative')
  })

  it('aceita só delta e cumulative como temporalidade', () => {
    expect(
      parseEnv({ ...DEV_ENV, OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'delta' })
        .OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE,
    ).toBe('delta')
    expect(
      problemsOf({ ...DEV_ENV, OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: 'lowmemory' }),
    ).toHaveLength(1)
  })

  it('lê endpoint e headers no formato da especificação, com URL encoding', () => {
    const env = parseEnv({
      ...PROD_ENV,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp',
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20dTpw, X-Scope = a=b ,',
    })
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'https://otlp-gateway-prod-sa-east-1.grafana.net/otlp',
    )
    expect(env.OTEL_EXPORTER_OTLP_HEADERS).toEqual({
      Authorization: 'Basic dTpw',
      'X-Scope': 'a=b',
    })
  })

  it.each([
    'Authorization',
    '=valor',
    'Authorization=',
    'Auth orization=x',
    'Authorization=%E0%A4%A',
  ])('headers malformados derrubam o boot sem repetir o valor (%s)', (headers) => {
    const problems = problemsOf({
      ...DEV_ENV,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_HEADERS: headers,
    })
    expect(problems).toEqual([
      'OTEL_EXPORTER_OTLP_HEADERS: deve ser uma lista chave=valor separada por vírgula',
    ])
  })

  it('headers sem endpoint e endpoint fora de http(s) derrubam o boot', () => {
    expect(problemsOf({ ...DEV_ENV, OTEL_EXPORTER_OTLP_HEADERS: 'a=b' })).toEqual([
      'OTEL_EXPORTER_OTLP_ENDPOINT: obrigatória com OTEL_EXPORTER_OTLP_HEADERS',
    ])
    expect(problemsOf({ ...DEV_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://x' })).toEqual([
      'OTEL_EXPORTER_OTLP_ENDPOINT: deve ser uma URL http(s)',
    ])
  })

  it('staging e produção exigem https (a credencial vai nos headers); dev aceita http local', () => {
    expect(problemsOf({ ...PROD_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otlp.example' })).toEqual(
      ['OTEL_EXPORTER_OTLP_ENDPOINT: APP_ENV=production exige https'],
    )
    expect(
      parseEnv({ ...DEV_ENV, OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })
        .OTEL_EXPORTER_OTLP_ENDPOINT,
    ).toBe('http://localhost:4318')
  })
})

describe('parseEnv', () => {
  it('aplica os padrões do plano', () => {
    const env = parseEnv(DEV_ENV)
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 4000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      APP_VERSION: '0.0.0',
      GIT_SHA: 'unknown',
      RUNTIME_TARGET: 'node',

      SHUTDOWN_GRACE_MS: DEFAULT_SHUTDOWN_GRACE_MS,
      DRAIN_DELAY_MS: DEFAULT_DRAIN_DELAY_MS,
    })
    expect(env.FUNCTION_MAX_DURATION_S).toBeUndefined()
    expect(env.VERCEL_REGION).toBeUndefined()
    expect(env.LLM_PROVIDER).toBeUndefined()
  })

  it('converte números e booleanos', () => {
    const env = parseEnv({
      ...DEV_ENV,
      PORT: '8080',
      LOG_PRETTY: 'true',
      GIT_SHA: 'ABCDEF1234567',
      SHUTDOWN_GRACE_MS: '30000',
    })
    expect(env.PORT).toBe(8080)
    expect(env.LOG_PRETTY).toBe(true)
    expect(env.GIT_SHA).toBe('abcdef1234567')
    expect(env.SHUTDOWN_GRACE_MS).toBe(30_000)
  })

  it('aceita a configuração de produção mínima', () => {
    expect(parseEnv(PROD_ENV).APP_ENV).toBe('production')
  })

  it('ignora variáveis que a API não usa', () => {
    const env = parseEnv({ ...DEV_ENV, LANGFUSE_INIT_USER_PASSWORD: 's' })
    expect(env).not.toHaveProperty('LANGFUSE_INIT_USER_PASSWORD')
    expect(env.DATABASE_URL).toBeUndefined()
  })

  describe('Langfuse', () => {
    const KEYS = { LANGFUSE_PUBLIC_KEY: 'pk-lf-abc', LANGFUSE_SECRET_KEY: 'sk-lf-def' }
    const PROD = {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      RUNTIME_TARGET: 'vercel',
      VERCEL_REGION: 'gru1',
      FUNCTION_MAX_DURATION_S: '120',
      WEB_ORIGIN: 'https://tekoia.vercel.app',
    }

    it('sem chaves, desligado; com chaves, o Cloud EU com o ambiente e o commit', () => {
      expect(langfuseSettings(parseEnv(DEV_ENV))).toBeNull()
      expect(langfuseSettings(parseEnv({ ...DEV_ENV, ...KEYS, GIT_SHA: 'a'.repeat(40) }))).toEqual({
        publicKey: 'pk-lf-abc',
        secretKey: 'sk-lf-def',
        baseUrl: 'https://cloud.langfuse.com',
        environment: 'development',
        release: 'a'.repeat(40),
        sampling: { rate: 1, overBudgetRate: 0.2, monthlyUnitsCutoff: 35_000 },
      })
    })

    it('LLM_TRACING_BACKEND=off desliga mesmo com as chaves', () => {
      expect(langfuseSettings(parseEnv({ ...DEV_ENV, ...KEYS, LLM_TRACING_BACKEND: 'off' }))).toBe(
        null,
      )
    })

    it.each([
      ['production', 1],
      ['staging', 0.1],
      ['ci', 0],
    ])('taxa padrão de %s: %s', (appEnv, rate) => {
      const base =
        appEnv === 'ci' ? { ...DEV_ENV, APP_ENV: 'ci' } : { ...PROD, APP_ENV: appEnv, ...KEYS }
      expect(langfuseSettings(parseEnv({ ...base, ...KEYS }))?.sampling.rate).toBe(rate)
    })

    it('taxas, corte, ambiente e release por env', () => {
      const settings = langfuseSettings(
        parseEnv({
          ...DEV_ENV,
          ...KEYS,
          LANGFUSE_SAMPLE_RATE: '0.5',
          LANGFUSE_SAMPLE_RATE_OVER_BUDGET: '0.05',
          LANGFUSE_MONTHLY_UNITS_CUTOFF: '1000',
          LANGFUSE_TRACING_ENVIRONMENT: 'dev-local',
          LANGFUSE_RELEASE: 'v1',
          LANGFUSE_BASE_URL: 'http://localhost:3100',
        }),
      )
      expect(settings).toMatchObject({
        baseUrl: 'http://localhost:3100',
        environment: 'dev-local',
        release: 'v1',
        sampling: { rate: 0.5, overBudgetRate: 0.05, monthlyUnitsCutoff: 1000 },
      })
    })

    it('chaves aos pares, com os prefixos do Langfuse, e https em produção', () => {
      expect(problemsOf({ ...DEV_ENV, LANGFUSE_PUBLIC_KEY: 'pk-lf-abc' })).toEqual([
        'LANGFUSE_SECRET_KEY: LANGFUSE_PUBLIC_KEY e LANGFUSE_SECRET_KEY vêm juntas',
      ])
      expect(problemsOf({ ...DEV_ENV, ...KEYS, LANGFUSE_SECRET_KEY: 'segredo' })).toContain(
        'LANGFUSE_SECRET_KEY: deve começar com sk-lf-',
      )
      expect(
        problemsOf({ ...PROD, ...KEYS, LANGFUSE_BASE_URL: 'http://langfuse.example' }),
      ).toEqual(['LANGFUSE_BASE_URL: APP_ENV=production exige https'])
      expect(problemsOf({ ...DEV_ENV, LANGFUSE_TRACING_ENVIRONMENT: 'langfuse-x' })[0]).toMatch(
        /^LANGFUSE_TRACING_ENVIRONMENT:/,
      )
      expect(problemsOf({ ...DEV_ENV, LANGFUSE_SAMPLE_RATE: '1.5' })[0]).toMatch(
        /^LANGFUSE_SAMPLE_RATE:/,
      )
    })
  })

  describe('Better Auth', () => {
    const SECRET = 'x'.repeat(32)
    const DB = {
      DATABASE_URL: 'postgres://h/db',
      EMBEDDINGS_PROVIDER: 'workers-ai',
      CF_ACCOUNT_ID: '0'.repeat(32),
      CF_AI_TOKEN: 't'.repeat(40),
    }
    const OAUTH = {
      GITHUB_CLIENT_ID: 'gh',
      GITHUB_CLIENT_SECRET: 'ghs',
      GOOGLE_CLIENT_ID: 'go',
      GOOGLE_CLIENT_SECRET: 'gos',
    }

    it('aceita o segredo e a versão dos Termos, com padrão', () => {
      const env = parseEnv({ ...DEV_ENV, BETTER_AUTH_SECRET: SECRET })
      expect(env.BETTER_AUTH_SECRET).toBe(SECRET)
      expect(env.TERMS_VERSION).toBe(DEFAULT_TERMS_VERSION)
      expect(problemsOf({ ...DEV_ENV, BETTER_AUTH_SECRET: 'curto' })).toEqual([
        'BETTER_AUTH_SECRET: deve ter ao menos 32 caracteres',
      ])
    })

    it('cada OAuth app vem com id e segredo', () => {
      expect(problemsOf({ ...DEV_ENV, GITHUB_CLIENT_ID: 'gh' })).toEqual([
        'GITHUB_CLIENT_SECRET: GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET vêm juntas',
      ])
      expect(problemsOf({ ...DEV_ENV, GOOGLE_CLIENT_SECRET: 'gos' })).toEqual([
        'GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET vêm juntas',
      ])
    })

    it('produção com banco exige o segredo e os dois OAuth apps', () => {
      expect(problemsOf({ ...PROD_ENV, ...DB })).toEqual([
        'LLM_PROVIDER: obrigatória com APP_ENV=production e DATABASE_URL',
        'BETTER_AUTH_SECRET: obrigatória com APP_ENV=production e DATABASE_URL',
        'GITHUB_CLIENT_ID: obrigatória com APP_ENV=production e DATABASE_URL',
        'GOOGLE_CLIENT_ID: obrigatória com APP_ENV=production e DATABASE_URL',
      ])
      const LLM = { LLM_PROVIDER: 'groq', GROQ_API_KEY: 'q'.repeat(16) }
      expect(
        parseEnv({ ...PROD_ENV, ...DB, ...OAUTH, ...LLM, BETTER_AUTH_SECRET: SECRET }).APP_ENV,
      ).toBe('production')
    })

    it.each(['development', 'ci'])(
      '%s com banco sobe sem OAuth apps (entrada por passkey e e-mail)',
      (appEnv) => {
        const env = parseEnv({ ...DEV_ENV, ...DB, APP_ENV: appEnv, BETTER_AUTH_SECRET: SECRET })
        expect(env.GITHUB_CLIENT_ID).toBeUndefined()
        expect(env.GOOGLE_CLIENT_ID).toBeUndefined()
      },
    )

    it.each(['BETTER_AUTH_TELEMETRY', 'BETTER_AUTH_TELEMETRY_ENDPOINT'])(
      'proíbe %s com qualquer valor',
      (name) => {
        expect(problemsOf({ ...DEV_ENV, [name]: '0' })).toEqual([
          `${name}: proibida (telemetria do Better Auth fica desligada)`,
        ])
      },
    )
  })

  it('reescrita da pergunta: desligada por padrão e só com LLM_PROVIDER (ADR 0034)', () => {
    expect(parseEnv(DEV_ENV).QUERY_REWRITE_ENABLED).toBe(false)
    expect(problemsOf({ ...DEV_ENV, QUERY_REWRITE_ENABLED: 'true' })).toEqual([
      'QUERY_REWRITE_ENABLED: exige LLM_PROVIDER (a reescrita usa a cadeia de LLM)',
    ])
    expect(
      parseEnv({ ...DEV_ENV, QUERY_REWRITE_ENABLED: 'true', LLM_PROVIDER: 'fake' })
        .QUERY_REWRITE_ENABLED,
    ).toBe(true)
  })

  it('exige APP_ENV e WEB_ORIGIN', () => {
    const problems = problemsOf({})
    expect(problems.some((p) => p.startsWith('APP_ENV:'))).toBe(true)
    expect(problems.some((p) => p.startsWith('WEB_ORIGIN:'))).toBe(true)
  })

  it.each([
    'https://tekoia.vercel.app/',
    'https://tekoia.vercel.app/app',
    'ftp://tekoia.vercel.app',
    'tekoia.vercel.app',
  ])('rejeita WEB_ORIGIN que não é origem exata: %s', (origin) => {
    expect(problemsOf({ ...DEV_ENV, WEB_ORIGIN: origin }).join('\n')).toMatch(/^WEB_ORIGIN:/m)
  })

  it('proíbe APP_ENV=development com NODE_ENV=production', () => {
    expect(problemsOf({ ...DEV_ENV, NODE_ENV: 'production' })).toEqual([
      'NODE_ENV: APP_ENV=development com NODE_ENV=production é proibido',
    ])
  })

  it.each(['staging', 'production'])('em %s exige NODE_ENV=production e https', (appEnv) => {
    const problems = problemsOf({
      APP_ENV: appEnv,
      WEB_ORIGIN: 'http://example.test',
      RUNTIME_TARGET: 'vercel',
      VERCEL_REGION: 'gru1',
      FUNCTION_MAX_DURATION_S: '120',
    })
    expect(problems).toEqual([
      `NODE_ENV: APP_ENV=${appEnv} exige NODE_ENV=production`,
      `WEB_ORIGIN: APP_ENV=${appEnv} exige origem https`,
    ])
  })

  it.each(['staging', 'production'])('em %s proíbe fakes e pino-pretty', (appEnv) => {
    const problems = problemsOf({
      ...PROD_ENV,
      APP_ENV: appEnv,
      LLM_PROVIDER: 'fake',
      EMBEDDINGS_PROVIDER: 'fake',
      EMBEDDINGS_FIXTURE_PATH: 'test/fixtures/corpus/embeddings.json.gz',
      LOG_PRETTY: '1',
    })
    expect(problems).toEqual([
      `LOG_PRETTY: APP_ENV=${appEnv} não usa pino-pretty (devDependency)`,
      `LLM_PROVIDER: fake é proibido com APP_ENV=${appEnv}`,
      `EMBEDDINGS_PROVIDER: fake é proibido com APP_ENV=${appEnv}`,
    ])
  })

  it('permite fakes em ci e development', () => {
    const env = parseEnv({
      ...DEV_ENV,
      APP_ENV: 'ci',
      LLM_PROVIDER: 'fake',
      EMBEDDINGS_PROVIDER: 'fake',
      EMBEDDINGS_FIXTURE_PATH: 'test/fixtures/corpus/embeddings.json.gz',
    })
    expect(env.LLM_PROVIDER).toBe('fake')
    expect(env.EMBEDDINGS_PROVIDER).toBe('fake')
  })

  describe('banco e embeddings (F2)', () => {
    it('aceita DATABASE_URL postgres e aplica os padrões do pool e do RRF mínimo', () => {
      const env = parseEnv({
        ...DEV_ENV,
        DATABASE_URL: 'postgresql://teko_app:x@localhost:5432/teko',
        EMBEDDINGS_PROVIDER: 'fake',
        EMBEDDINGS_FIXTURE_PATH: 'f.json.gz',
      })
      expect(env.DATABASE_URL).toBe('postgresql://teko_app:x@localhost:5432/teko')
      expect(env.DATABASE_MAX_CONNECTIONS).toBe(3)
      expect(env.EMBEDDINGS_FAKE_STRICT).toBe(false)
      expect(env.MIN_EVIDENCE_RRF).toBe(0)
      expect(
        parseEnv({
          ...DEV_ENV,
          DATABASE_URL: 'postgres://h/db',
          EMBEDDINGS_PROVIDER: 'fake',
          EMBEDDINGS_FIXTURE_PATH: 'f',
          EMBEDDINGS_FAKE_STRICT: 'true',
          MIN_EVIDENCE_RRF: '0.02',
          DATABASE_MAX_CONNECTIONS: '4',
        }),
      ).toMatchObject({
        EMBEDDINGS_FAKE_STRICT: true,
        MIN_EVIDENCE_RRF: 0.02,
        DATABASE_MAX_CONNECTIONS: 4,
      })
    })

    it.each(['mysql://h/db', 'http://h/db', 'postgresql//h'])(
      'rejeita DATABASE_URL que não é postgres: %s',
      (url) => {
        expect(
          problemsOf({
            ...DEV_ENV,
            DATABASE_URL: url,
            EMBEDDINGS_PROVIDER: 'fake',
            EMBEDDINGS_FIXTURE_PATH: 'f',
          }),
        ).toEqual(['DATABASE_URL: deve ser uma URL postgresql://'])
      },
    )

    it('DATABASE_URL exige EMBEDDINGS_PROVIDER', () => {
      expect(problemsOf({ ...DEV_ENV, DATABASE_URL: 'postgres://h/db' })).toEqual([
        'EMBEDDINGS_PROVIDER: obrigatória com DATABASE_URL (a busca precisa de embeddings)',
      ])
    })

    it('o fake exige a fixture; o Workers AI exige conta e token', () => {
      expect(problemsOf({ ...DEV_ENV, EMBEDDINGS_PROVIDER: 'fake' })).toEqual([
        'EMBEDDINGS_FIXTURE_PATH: obrigatória com EMBEDDINGS_PROVIDER=fake',
      ])
      expect(problemsOf({ ...DEV_ENV, EMBEDDINGS_PROVIDER: 'workers-ai' })).toEqual([
        'CF_ACCOUNT_ID: obrigatória com EMBEDDINGS_PROVIDER=workers-ai',
        'CF_AI_TOKEN: obrigatória com EMBEDDINGS_PROVIDER=workers-ai',
      ])
      const env = parseEnv({
        ...DEV_ENV,
        EMBEDDINGS_PROVIDER: 'workers-ai',
        CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CF_AI_TOKEN: 'token-de-teste-com-20-chars',
      })
      expect(env.EMBEDDINGS_PROVIDER).toBe('workers-ai')
      expect(env.RERANKER_PROVIDER).toBe('none')
    })

    it('o reranker do Workers AI exige as mesmas conta e token (ADR 0027)', () => {
      expect(problemsOf({ ...DEV_ENV, RERANKER_PROVIDER: 'workers-ai' })).toEqual([
        'CF_ACCOUNT_ID: obrigatória com RERANKER_PROVIDER=workers-ai',
        'CF_AI_TOKEN: obrigatória com RERANKER_PROVIDER=workers-ai',
      ])
      expect(problemsOf({ ...DEV_ENV, RERANKER_PROVIDER: 'cohere' })).toHaveLength(1)
      const env = parseEnv({
        ...DEV_ENV,
        RERANKER_PROVIDER: 'workers-ai',
        CF_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
        CF_AI_TOKEN: 'token-de-teste-com-20-chars',
      })
      expect(env.RERANKER_PROVIDER).toBe('workers-ai')
    })

    it('valida o formato da conta, do token e os limites numéricos', () => {
      expect(
        problemsOf({
          ...DEV_ENV,
          CF_ACCOUNT_ID: 'xyz',
          CF_AI_TOKEN: 'curto',
          MIN_EVIDENCE_RRF: '2',
          DATABASE_MAX_CONNECTIONS: '0',
        }).map((p) => p.split(':')[0]),
      ).toEqual(['DATABASE_MAX_CONNECTIONS', 'CF_ACCOUNT_ID', 'CF_AI_TOKEN', 'MIN_EVIDENCE_RRF'])
    })
  })

  describe('ingestão (F3)', () => {
    const NEON_KEY = 'napi_chave-de-teste-com-mais-de-20'
    const GH_TOKEN = 'ghs_token-de-teste-com-mais-de-20'

    it('aplica os padrões do orçamento e da guarda de tamanho', () => {
      const env = parseEnv(DEV_ENV)
      expect(env.EMBED_NEURON_BUDGET).toBe(8000)
      expect(env.INGEST_MAX_DB_BYTES).toBe(800 * 1024 * 1024)
      expect(env.GITHUB_TOKEN).toBeUndefined()
      expect(env.NEON_API_KEY_STAGING).toBeUndefined()
    })

    it('aceita o GitHub e o Neon completos e converte os números', () => {
      const env = parseEnv({
        ...DEV_ENV,
        GITHUB_TOKEN: GH_TOKEN,
        GITHUB_REPOSITORY: 'dono/repo',
        NEON_API_KEY_STAGING: NEON_KEY,
        NEON_STAGING_PROJECT_ID: 'snowy-sea-123456',
        EMBED_NEURON_BUDGET: '5000',
        INGEST_MAX_DB_BYTES: '1000',
      })
      expect(env).toMatchObject({
        GITHUB_REPOSITORY: 'dono/repo',
        NEON_STAGING_PROJECT_ID: 'snowy-sea-123456',
        EMBED_NEURON_BUDGET: 5000,
        INGEST_MAX_DB_BYTES: 1000,
      })
    })

    it('exige os pares juntos, sem citar o valor do segredo', () => {
      expect(problemsOf({ ...DEV_ENV, NEON_STAGING_PROJECT_ID: 'p1' })).toEqual([
        'NEON_API_KEY_STAGING: NEON_API_KEY_STAGING e NEON_STAGING_PROJECT_ID vêm juntas (medição de CU-h da ingestão)',
      ])
      const problems = problemsOf({ ...DEV_ENV, NEON_API_KEY_STAGING: NEON_KEY })
      expect(problems).toEqual([
        'NEON_STAGING_PROJECT_ID: NEON_API_KEY_STAGING e NEON_STAGING_PROJECT_ID vêm juntas (medição de CU-h da ingestão)',
      ])
      expect(problems.join('\n')).not.toContain(NEON_KEY)
    })

    it.each([
      ['NEON_STAGING_PROJECT_ID', 'Projeto Inválido'],
      ['EMBED_NEURON_BUDGET', '10001'],
      ['EMBED_NEURON_BUDGET', '-1'],
      ['INGEST_MAX_DB_BYTES', '0'],
    ])('rejeita %s=%j', (key, value) => {
      expect(problemsOf({ ...DEV_ENV, [key]: value }).join('\n')).toMatch(
        new RegExp(`^${key}:`, 'm'),
      )
    })

    it('proíbe as credenciais da ingestão na API publicada', () => {
      const problems = problemsOf({
        ...PROD_ENV,
        GITHUB_TOKEN: GH_TOKEN,
        GITHUB_REPOSITORY: 'dono/repo',
        NEON_API_KEY_STAGING: NEON_KEY,
        NEON_STAGING_PROJECT_ID: 'p1',
      })
      expect(problems).toEqual([
        'GITHUB_TOKEN: proibida com RUNTIME_TARGET=vercel (só a CLI de ingestão usa)',
        'NEON_API_KEY_STAGING: proibida com RUNTIME_TARGET=vercel (só a CLI de ingestão usa)',
      ])
    })

    describe('BLOB_STORE (ADR 0030)', () => {
      it('sem valor, aceita a ausência de credenciais (store em memória na execução local)', () => {
        expect(parseEnv(DEV_ENV).BLOB_STORE).toBeUndefined()
      })

      it('github-releases exige GITHUB_TOKEN; o token exige GITHUB_REPOSITORY', () => {
        expect(problemsOf({ ...DEV_ENV, BLOB_STORE: 'github-releases' })).toEqual([
          'GITHUB_TOKEN: obrigatória com BLOB_STORE=github-releases',
        ])
        expect(problemsOf({ ...DEV_ENV, GITHUB_TOKEN: GH_TOKEN })).toEqual([
          'GITHUB_REPOSITORY: obrigatória com GITHUB_TOKEN (owner/repo dos releases)',
        ])
        expect(
          parseEnv({
            ...DEV_ENV,
            BLOB_STORE: 'github-releases',
            GITHUB_TOKEN: GH_TOKEN,
            GITHUB_REPOSITORY: 'dono/repo',
          }),
        ).toMatchObject({ BLOB_STORE: 'github-releases', GITHUB_REPOSITORY: 'dono/repo' })
      })

      it('netlify não é mais backend (etapa C2 da ADR 0030)', () => {
        expect(problemsOf({ ...DEV_ENV, BLOB_STORE: 'netlify' }).join('\n')).toMatch(
          /^BLOB_STORE:/m,
        )
      })

      it.each([
        ['BLOB_STORE', 's3'],
        ['GITHUB_REPOSITORY', 'sem-barra'],
        ['GITHUB_TOKEN', 'curto'],
      ])('rejeita %s=%j', (key, value) => {
        expect(problemsOf({ ...DEV_ENV, [key]: value }).join('\n')).toMatch(
          new RegExp(`^${key}:`, 'm'),
        )
      })
    })
  })

  it('derruba o boot com *_BASE_URL de provedor, mas não com outros *_BASE_URL', () => {
    const problems = problemsOf({
      ...DEV_ENV,
      OPENAI_BASE_URL: 'https://evil.example',
      GOOGLE_GEMINI_BASE_URL: 'https://evil.example',
      GROQ_API_BASE: 'https://evil.example',
      LANGFUSE_BASE_URL: 'http://localhost:3100',
    })
    expect(problems).toEqual([
      'GOOGLE_GEMINI_BASE_URL: proibida (o host do provedor é fixo no código)',
      'GROQ_API_BASE: proibida (o host do provedor é fixo no código)',
      'OPENAI_BASE_URL: proibida (o host do provedor é fixo no código)',
    ])
  })

  it('lista as *_BASE_URL proibidas em ordem de unidade de código, sem depender de locale', () => {
    const problems = problemsOf({
      ...DEV_ENV,
      OPENAI_x_BASE_URL: 'https://evil.example',
      OPENAI_X_BASE_URL: 'https://evil.example',
      GROQ_BASE_URL: 'https://evil.example',
      GEMINI_BASE_URL: 'https://evil.example',
    })
    // localeCompare poria `OPENAI_x` antes de `OPENAI_X`; a ordem do log precisa ser estável.
    expect(problems.map((problem) => problem.split(':')[0])).toEqual([
      'GEMINI_BASE_URL',
      'GROQ_BASE_URL',
      'OPENAI_X_BASE_URL',
      'OPENAI_x_BASE_URL',
    ])
  })

  it('sem fatos injetados, confere a versão do próprio processo', () => {
    if (process.version.startsWith('v24.')) {
      expect(parseProcessEnv(PROD_ENV).RUNTIME_TARGET).toBe('vercel')
    } else {
      expect(() => parseProcessEnv(PROD_ENV)).toThrow(/exige Node 24/)
    }
  })

  it('a rede padrão do Caddy é o CIDR /24 da stack de CI e local', () => {
    expect(DEFAULT_TRUST_PROXY).toBe('172.30.0.0/24')
  })

  it('exige grace >= 30 s e drenagem menor que o grace', () => {
    expect(problemsOf({ ...DEV_ENV, SHUTDOWN_GRACE_MS: '29999' })[0]).toMatch(/^SHUTDOWN_GRACE_MS:/)
    expect(problemsOf({ ...DEV_ENV, SHUTDOWN_GRACE_MS: '30000', DRAIN_DELAY_MS: '30000' })).toEqual(
      ['DRAIN_DELAY_MS: deve ser menor que SHUTDOWN_GRACE_MS'],
    )
  })

  it.each([
    ['PORT', '0'],
    ['PORT', 'abc'],
    ['LOG_LEVEL', 'verbose'],
    ['RUNTIME_TARGET', 'lambda'],
    ['RUNTIME_TARGET', 'render'],
    ['RUNTIME_TARGET', 'vm'],
    ['FUNCTION_MAX_DURATION_S', '301'],
    ['FUNCTION_MAX_DURATION_S', '0'],
    ['APP_VERSION', 'v1'],
  ])('rejeita %s=%j', (key, value) => {
    expect(problemsOf({ ...DEV_ENV, [key]: value }).join('\n')).toMatch(
      new RegExp(`^${key}[:.]`, 'm'),
    )
  })

  it('na Vercel exige FUNCTION_MAX_DURATION_S, sem padrão, até o teto do Hobby', () => {
    expect(problemsOf({ ...DEV_ENV, RUNTIME_TARGET: 'vercel' })).toEqual([
      'FUNCTION_MAX_DURATION_S: obrigatória com RUNTIME_TARGET=vercel (o maxDuration do .vc-config.json)',
    ])
    const max = String(HOBBY_MAX_DURATION_S)
    expect(
      parseEnv({ ...DEV_ENV, RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: max })
        .FUNCTION_MAX_DURATION_S,
    ).toBe(HOBBY_MAX_DURATION_S)
    expect(parseEnv(DEV_ENV).FUNCTION_MAX_DURATION_S).toBeUndefined()
  })

  describe('RUNTIME_TARGET explícito em staging e produção (sem padrão)', () => {
    const NO_TARGET = { ...PROD_ENV, RUNTIME_TARGET: undefined, VERCEL_REGION: undefined }

    it.each(['staging', 'production'])('em %s derruba o boot sem RUNTIME_TARGET', (appEnv) => {
      expect(problemsOf({ ...NO_TARGET, APP_ENV: appEnv })).toEqual([
        `RUNTIME_TARGET: obrigatória com APP_ENV=${appEnv} (o padrão node só vale em development e ci)`,
      ])
    })

    it.each(['staging', 'production'])('em %s proíbe RUNTIME_TARGET=node', (appEnv) => {
      expect(problemsOf({ ...NO_TARGET, APP_ENV: appEnv, RUNTIME_TARGET: 'node' })).toEqual([
        `RUNTIME_TARGET: node é proibido com APP_ENV=${appEnv} (staging e produção rodam na Vercel)`,
      ])
    })

    it.each(['development', 'ci'])('em %s o padrão continua node', (appEnv) => {
      expect(parseEnv({ ...DEV_ENV, APP_ENV: appEnv }).RUNTIME_TARGET).toBe('node')
    })

    it('aceita vercel em produção', () => {
      expect(parseEnv(PROD_ENV).RUNTIME_TARGET).toBe('vercel')
    })
  })

  describe('variável de sistema VERCEL=1 (runtime da Vercel)', () => {
    it.each([
      ['development', undefined],
      ['ci', 'node'],
      ['production', undefined],
      ['production', 'node'],
    ])('APP_ENV=%s com RUNTIME_TARGET=%j derruba o boot', (appEnv, target) => {
      const problems = problemsOf({
        ...PROD_ENV,
        NODE_ENV: appEnv === 'development' ? 'development' : 'production',
        APP_ENV: appEnv,
        RUNTIME_TARGET: target,
        VERCEL: '1',
      })
      expect(problems).toContain(
        'RUNTIME_TARGET: a variável de sistema VERCEL=1 está presente; exige RUNTIME_TARGET=vercel',
      )
    })

    it('aceita VERCEL=1 com RUNTIME_TARGET=vercel', () => {
      const env = parseEnv({ ...PROD_ENV, VERCEL: '1' }, NODE_24)
      expect(env.RUNTIME_TARGET).toBe('vercel')
    })

    it.each(['0', ''])('ignora VERCEL=%j (só 1 indica o runtime da Vercel)', (value) => {
      expect(parseEnv({ ...DEV_ENV, VERCEL: value }).RUNTIME_TARGET).toBe('node')
    })
  })

  describe('RUNTIME_TARGET=vercel em staging e produção', () => {
    const VERCEL_PROD = PROD_ENV

    it('aceita gru1 com Node 24', () => {
      expect(parseEnv(VERCEL_PROD, NODE_24).VERCEL_REGION).toBe(VERCEL_FUNCTION_REGION)
      expect(parseEnv({ ...VERCEL_PROD, APP_ENV: 'staging' }, NODE_24).APP_ENV).toBe('staging')
    })

    it.each([undefined, 'iad1'])('exige VERCEL_REGION=gru1 (recebido %j)', (region) => {
      const problems = problemsOf({ ...VERCEL_PROD, VERCEL_REGION: region })
      expect(problems).toEqual([
        'VERCEL_REGION: RUNTIME_TARGET=vercel em production exige a região gru1',
      ])
    })

    it('exige Node 24 em runtime', () => {
      expect(() => parseEnv(VERCEL_PROD, { nodeVersion: 'v26.1.0' })).toThrow(
        /RUNTIME_TARGET=vercel em production exige Node 24/,
      )
    })

    it('não confere região nem Node fora de staging e produção', () => {
      const env = parseEnv(
        { ...DEV_ENV, APP_ENV: 'ci', RUNTIME_TARGET: 'vercel', FUNCTION_MAX_DURATION_S: '120' },
        { nodeVersion: 'v26.1.0' },
      )
      expect(env.RUNTIME_TARGET).toBe('vercel')
    })
  })

  it('a mensagem lista as variáveis sem expor valores', () => {
    const secret = 'super-secret-value'
    try {
      parseEnv({ ...DEV_ENV, OPENAI_BASE_URL: secret, PORT: secret })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      expect((error as Error).message).toMatch(/^Configuração inválida/)
      expect((error as Error).message).not.toContain(secret)
    }
  })
})

describe('loadCliEnv', () => {
  it('dá à CLI o APP_ENV e o WEB_ORIGIN de desenvolvimento, sem sobrepor o ambiente', () => {
    expect(loadCliEnv({}).APP_ENV).toBe('development')
    expect(loadCliEnv({}).WEB_ORIGIN).toBe('http://localhost:3000')
    expect(loadCliEnv({ APP_ENV: 'ci' }).APP_ENV).toBe('ci')
  })
})

describe('loadMaintenanceEnv', () => {
  it('lê só a DATABASE_URL, sem exigir o resto da configuração da API', () => {
    expect(
      loadMaintenanceEnv({
        DATABASE_URL: 'postgresql://app',
        NEON_PROD_WATCH_URL: 'postgresql://p',
      }),
    ).toEqual({ DATABASE_URL: 'postgresql://app' })
  })

  it('trata a URL vazia (segredo ausente no Actions) como ausente', () => {
    expect(loadMaintenanceEnv({ DATABASE_URL: '' })).toEqual({ DATABASE_URL: undefined })
    expect(loadMaintenanceEnv({})).toEqual({ DATABASE_URL: undefined })
  })
})

describe('loadWatchEnv', () => {
  it('lê só as duas URLs do teko_watch', () => {
    expect(
      loadWatchEnv({
        NEON_PROD_WATCH_URL: 'postgresql://p',
        NEON_STAGING_WATCH_URL: 'postgresql://s',
        DATABASE_URL: 'postgresql://owner',
      }),
    ).toEqual({ NEON_PROD_WATCH_URL: 'postgresql://p', NEON_STAGING_WATCH_URL: 'postgresql://s' })
    expect(loadWatchEnv({})).toEqual({
      NEON_PROD_WATCH_URL: undefined,
      NEON_STAGING_WATCH_URL: undefined,
    })
  })
})
