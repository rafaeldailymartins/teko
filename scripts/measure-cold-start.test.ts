import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  coldStartEnv,
  DEFAULT_RUNS,
  FAKE_SENSITIVE,
  MeasureError,
  median,
  parseOptions,
  parseProbeOutput,
  RESULT_MARKER,
  RUNTIME_ENV,
  summarize,
} from './measure-cold-start.ts'

/**
 * Medição do CPU do cold start (`scripts/measure-cold-start.ts`, `pnpm test:scripts`): o ambiente
 * de produção com Sensitive de mentira, a leitura do resultado do filho e o resumo. A medição em
 * si precisa da Function montada e fica fora dos testes.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PRODUCTION = JSON.parse(
  readFileSync(join(REPO_ROOT, 'infra', 'vercel', 'env.production.json'), 'utf8'),
) as {
  config: Record<string, { value: string }>
  sensitive: Record<string, unknown>
}

function probeLine(result: Record<string, unknown>): string {
  return `{"level":30,"msg":"incoming request"}\n${RESULT_MARKER}${JSON.stringify(result)}\n`
}

const HEALTH_BODY = JSON.stringify({
  status: 'ok',
  version: '0.0.0-cold-start',
  gitSha: '0000000',
  env: 'production',
})

describe('coldStartEnv', () => {
  it('usa os config da produção, um valor de mentira para cada Sensitive e o ambiente da Vercel', () => {
    const env = coldStartEnv(PRODUCTION, { PATH: '/usr/bin' })
    for (const [name, entry] of Object.entries(PRODUCTION.config)) {
      if (!(name in RUNTIME_ENV)) {
        assert.equal(env[name], entry.value, name)
      }
    }
    for (const name of Object.keys(PRODUCTION.sensitive)) {
      assert.equal(env[name], FAKE_SENSITIVE[name], name)
    }
    assert.equal(env['APP_ENV'], 'production')
    assert.equal(env['RUNTIME_TARGET'], 'vercel')
    assert.equal(env['VERCEL'], '1')
    assert.equal(env['VERCEL_REGION'], 'gru1')
    assert.equal(env['PATH'], '/usr/bin')
  })

  it('não herda o ambiente de quem chama, só o que o Node precisa para rodar', () => {
    const env = coldStartEnv(PRODUCTION, {
      PATH: '/usr/bin',
      DATABASE_URL: 'postgresql://real:segredo@db.neon.tech/teko',
      LLM_KILL_SWITCH: 'true',
    })
    assert.equal(env['DATABASE_URL'], FAKE_SENSITIVE['DATABASE_URL'])
    assert.equal(env['LLM_KILL_SWITCH'], undefined)
  })

  it('todo host que a API contataria é .invalid (RFC 6761): banco, OTLP e Langfuse', () => {
    const env = coldStartEnv(PRODUCTION, {})
    // A WEB_ORIGIN é a origem real, mas só vira header e base de URL; nada a chama.
    const contacted = ['DATABASE_URL', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'LANGFUSE_BASE_URL']
    for (const name of contacted) {
      assert.match(new URL(env[name] ?? '').hostname, /\.invalid$/, name)
    }
    const fakeUrls = Object.values({ ...FAKE_SENSITIVE, ...RUNTIME_ENV }).filter((value) =>
      /^[a-z]+:\/\//.test(value),
    )
    for (const value of fakeUrls) {
      assert.match(new URL(value).hostname, /\.invalid$/, value)
    }
  })

  it('falha nomeando o Sensitive sem valor de mentira', () => {
    assert.throws(
      () => coldStartEnv({ config: {}, sensitive: { NOVA_CHAVE: {} } }, {}),
      (error: unknown) => error instanceof MeasureError && /NOVA_CHAVE/.test(error.message),
    )
  })
})

describe('parseProbeOutput', () => {
  it('lê os tempos da linha do resultado, no meio do log do pino', () => {
    const stdout = probeLine({
      importCpuMs: 1200.5,
      coldStartCpuMs: 1250,
      processCpuMs: 1300,
      status: 200,
      body: HEALTH_BODY,
    })
    assert.deepEqual(parseProbeOutput(stdout), {
      importCpuMs: 1200.5,
      coldStartCpuMs: 1250,
      processCpuMs: 1300,
    })
  })

  it('recusa saída sem resultado, /healthz fora de 200 ou fora de produção', () => {
    const base = { importCpuMs: 1, coldStartCpuMs: 2, processCpuMs: 3 }
    const cases: [string, RegExp][] = [
      ['{"level":50,"msg":"boot failed"}\n', /sem a linha do resultado/],
      [probeLine({ ...base, status: 503, body: HEALTH_BODY }), /respondeu 503/],
      [
        probeLine({ ...base, status: 200, body: HEALTH_BODY.replace('production', 'ci') }),
        /sem status ok em produção/,
      ],
      [probeLine({ status: 200, body: HEALTH_BODY }), /sem os tempos de CPU/],
    ]
    for (const [stdout, message] of cases) {
      assert.throws(
        () => parseProbeOutput(stdout),
        (error: unknown) => error instanceof MeasureError && message.test(error.message),
      )
    }
  })
})

describe('resumo', () => {
  it('mediana arredondada, com quantidade par e ímpar', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 3)
    assert.equal(median([1000.4]), 1000)
    assert.throws(() => median([]), MeasureError)
  })

  it('summarize traz as medianas e a faixa do cold start', () => {
    const summary = summarize([
      { importCpuMs: 900, coldStartCpuMs: 1000, processCpuMs: 1100 },
      { importCpuMs: 1100, coldStartCpuMs: 1200, processCpuMs: 1300 },
      { importCpuMs: 1000, coldStartCpuMs: 1100, processCpuMs: 1200 },
    ])
    assert.deepEqual(summary, {
      runs: 3,
      importCpuMs: 1000,
      coldStartCpuMs: 1100,
      processCpuMs: 1200,
      minColdStartCpuMs: 1000,
      maxColdStartCpuMs: 1200,
    })
  })
})

describe('parseOptions', () => {
  it('padrão, --runs e --cpu-prof', () => {
    assert.deepEqual(parseOptions([]), { runs: DEFAULT_RUNS, cpuProf: false })
    assert.deepEqual(parseOptions(['--runs', '3', '--cpu-prof']), { runs: 3, cpuProf: true })
  })

  it('recusa caminho, posicional e --runs fora da faixa', () => {
    for (const args of [
      ['--runs', '0'],
      ['--runs', '2.5'],
      ['--runs', '999'],
      ['x'],
      ['--out', 'y'],
    ]) {
      assert.throws(() => parseOptions(args), Error, args.join(' '))
    }
  })
})
