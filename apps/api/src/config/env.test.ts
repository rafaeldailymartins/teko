import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRAIN_DELAY_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  DEFAULT_TRUST_PROXY,
  EnvValidationError,
  HOBBY_MAX_DURATION_S,
  loadCliEnv,
  parseEnv,
  VERCEL_FUNCTION_REGION,
} from './env.ts'

const DEV_ENV = { APP_ENV: 'development', WEB_ORIGIN: 'http://localhost:3000' } as const

/** Produção mínima válida sem depender da região nem do Node da Vercel: Plano B (Render). */
const PROD_ENV = {
  NODE_ENV: 'production',
  APP_ENV: 'production',
  WEB_ORIGIN: 'https://tekoia.netlify.app',
  RUNTIME_TARGET: 'render',
  TRUST_PROXY: '1',
} as const

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
      FUNCTION_MAX_DURATION_S: HOBBY_MAX_DURATION_S,
      SHUTDOWN_GRACE_MS: DEFAULT_SHUTDOWN_GRACE_MS,
      DRAIN_DELAY_MS: DEFAULT_DRAIN_DELAY_MS,
    })
    expect(env.TRUST_PROXY).toBeUndefined()
    expect(env.VERCEL_REGION).toBeUndefined()
    expect(env.LLM_PROVIDER).toBeUndefined()
  })

  it('aceita TRUST_PROXY como número de saltos', () => {
    expect(parseEnv({ ...DEV_ENV, TRUST_PROXY: ' 2 ' }).TRUST_PROXY).toBe(2)
  })

  it('converte números, booleanos e listas', () => {
    const env = parseEnv({
      ...DEV_ENV,
      PORT: '8080',
      LOG_PRETTY: 'true',
      TRUST_PROXY: ' 10.0.0.1 , 172.30.0.0/24,::1 ',
      GIT_SHA: 'ABCDEF1234567',
      SHUTDOWN_GRACE_MS: '30000',
    })
    expect(env.PORT).toBe(8080)
    expect(env.LOG_PRETTY).toBe(true)
    expect(env.TRUST_PROXY).toEqual(['10.0.0.1', '172.30.0.0/24', '::1'])
    expect(env.GIT_SHA).toBe('abcdef1234567')
    expect(env.SHUTDOWN_GRACE_MS).toBe(30_000)
  })

  it('aceita a configuração de produção mínima', () => {
    expect(parseEnv(PROD_ENV).APP_ENV).toBe('production')
  })

  it('ignora variáveis que a API ainda não usa (segredos de fases seguintes)', () => {
    const env = parseEnv({ ...DEV_ENV, BETTER_AUTH_SECRET: 's' })
    expect(env).not.toHaveProperty('BETTER_AUTH_SECRET')
    expect(env.DATABASE_URL).toBeUndefined()
  })

  it('exige APP_ENV e WEB_ORIGIN', () => {
    const problems = problemsOf({})
    expect(problems.some((p) => p.startsWith('APP_ENV:'))).toBe(true)
    expect(problems.some((p) => p.startsWith('WEB_ORIGIN:'))).toBe(true)
  })

  it.each([
    'https://tekoia.netlify.app/',
    'https://tekoia.netlify.app/app',
    'ftp://tekoia.netlify.app',
    'tekoia.netlify.app',
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
      RUNTIME_TARGET: 'render',
      TRUST_PROXY: '1',
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
      expect(env.DATABASE_MAX_CONNECTIONS).toBe(5)
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
          DATABASE_MAX_CONNECTIONS: '3',
        }),
      ).toMatchObject({
        EMBEDDINGS_FAKE_STRICT: true,
        MIN_EVIDENCE_RRF: 0.02,
        DATABASE_MAX_CONNECTIONS: 3,
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
    const vercelProd = {
      ...PROD_ENV,
      RUNTIME_TARGET: 'vercel',
      TRUST_PROXY: undefined,
      VERCEL_REGION: 'gru1',
    } as const
    if (process.version.startsWith('v24.')) {
      expect(parseEnv(vercelProd).RUNTIME_TARGET).toBe('vercel')
    } else {
      expect(() => parseEnv(vercelProd)).toThrow(/exige Node 24/)
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
    ['TRUST_PROXY', 'not-an-ip'],
    ['TRUST_PROXY', ' , '],
    ['TRUST_PROXY', '0'],
    ['TRUST_PROXY', '11'],
    ['RUNTIME_TARGET', 'lambda'],
    ['RUNTIME_TARGET', 'vm'],
    ['FUNCTION_MAX_DURATION_S', '301'],
    ['FUNCTION_MAX_DURATION_S', '0'],
    ['APP_VERSION', 'v1'],
  ])('rejeita %s=%j', (key, value) => {
    expect(problemsOf({ ...DEV_ENV, [key]: value }).join('\n')).toMatch(
      new RegExp(`^${key}[:.]`, 'm'),
    )
  })

  it('na Vercel o trustProxy é fixo; no Render, obrigatório', () => {
    expect(problemsOf({ ...DEV_ENV, RUNTIME_TARGET: 'vercel', TRUST_PROXY: '1' })).toEqual([
      'TRUST_PROXY: não se aplica com RUNTIME_TARGET=vercel (1 salto, fixo no código)',
    ])
    expect(problemsOf({ ...DEV_ENV, RUNTIME_TARGET: 'render' })).toEqual([
      'TRUST_PROXY: obrigatória com RUNTIME_TARGET=render (valor medido no ensaio)',
    ])
    expect(parseEnv({ ...DEV_ENV, RUNTIME_TARGET: 'render', TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1)
  })

  describe('RUNTIME_TARGET explícito em staging e produção (sem padrão)', () => {
    const NO_TARGET = { ...PROD_ENV, RUNTIME_TARGET: undefined, TRUST_PROXY: undefined }

    it.each(['staging', 'production'])('em %s derruba o boot sem RUNTIME_TARGET', (appEnv) => {
      expect(problemsOf({ ...NO_TARGET, APP_ENV: appEnv })).toEqual([
        `RUNTIME_TARGET: obrigatória com APP_ENV=${appEnv} (o padrão node só vale em development e ci)`,
      ])
    })

    it.each(['staging', 'production'])('em %s proíbe RUNTIME_TARGET=node', (appEnv) => {
      expect(problemsOf({ ...NO_TARGET, APP_ENV: appEnv, RUNTIME_TARGET: 'node' })).toEqual([
        `RUNTIME_TARGET: node é proibido com APP_ENV=${appEnv} (staging e produção rodam na Vercel ou no Render)`,
      ])
    })

    it.each(['development', 'ci'])('em %s o padrão continua node', (appEnv) => {
      expect(parseEnv({ ...DEV_ENV, APP_ENV: appEnv }).RUNTIME_TARGET).toBe('node')
    })

    it('aceita render com TRUST_PROXY medido em produção', () => {
      expect(parseEnv(PROD_ENV).RUNTIME_TARGET).toBe('render')
    })
  })

  describe('variável de sistema VERCEL=1 (runtime da Vercel)', () => {
    it.each([
      ['development', undefined],
      ['ci', 'node'],
      ['ci', 'render'],
      ['production', undefined],
      ['production', 'node'],
      ['production', 'render'],
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
      const env = parseEnv(
        {
          ...PROD_ENV,
          RUNTIME_TARGET: 'vercel',
          TRUST_PROXY: undefined,
          VERCEL: '1',
          VERCEL_REGION: 'gru1',
        },
        { nodeVersion: 'v24.12.0' },
      )
      expect(env.RUNTIME_TARGET).toBe('vercel')
    })

    it.each(['0', ''])('ignora VERCEL=%j (só 1 indica o runtime da Vercel)', (value) => {
      expect(parseEnv({ ...DEV_ENV, VERCEL: value }).RUNTIME_TARGET).toBe('node')
    })
  })

  describe('RUNTIME_TARGET=vercel em staging e produção', () => {
    const VERCEL_PROD = {
      ...PROD_ENV,
      RUNTIME_TARGET: 'vercel',
      TRUST_PROXY: undefined,
      VERCEL_REGION: 'gru1',
    } as const
    const NODE_24 = { nodeVersion: 'v24.12.0' }

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
        { ...DEV_ENV, APP_ENV: 'ci', RUNTIME_TARGET: 'vercel' },
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
