import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addWindow,
  type ExecResult,
  estimateUsage,
  FIREWALL_SCRIPT,
  HOBBY_QUOTAS,
  LAG_MINUTES,
  LOOKBACK_MINUTES,
  levelFor,
  parseMetricsOutput,
  parseOptions,
  parseState,
  planWindow,
  type RunDeps,
  rollupColumn,
  run,
  STATE_FILE,
  USAGE_SOURCES,
  type UsageSource,
  type UsageState,
  VERCEL_CLI,
} from './vercel-usage.ts'

const NOW = new Date('2026-11-18T09:45:30.000Z')
const MINUTE = 60_000
const DAY = 86_400_000
/** Janela da primeira execução em NOW: 09:18 a 09:40 (27 min para trás, 5 de atraso). */
const SINCE = Date.parse('2026-11-18T09:18:00.000Z')
const UNTIL = Date.parse('2026-11-18T09:40:00.000Z')
const ORG = 'team_abc123'
const STAGING = 'prj_rgXwv6zcTTb1UPU1qkEMrAWu6hY5'
const PROD = 'prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as'
const OTLP = {
  GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.grafana.net/otlp',
  GRAFANA_OTLP_INSTANCE_ID: '1',
  GRAFANA_OTLP_TOKEN: 'otlp-token',
}

function source(resource: string): UsageSource {
  const found = USAGE_SOURCES.find((entry) => entry.resource === resource)
  assert.ok(found)
  return found
}

/**
 * Formato real do `vercel metrics <métrica> --all --json` (Vercel CLI 65.11.0, `formatQueryJson`
 * sobre `canonicalResponseToMetricsResponse`); `value` `undefined` = janela sem invocação, como a
 * conta pausada respondeu em 2026-11-25.
 */
function metricsJson(entry: UsageSource, value?: number | null): string {
  return JSON.stringify(
    {
      query: {
        metric: entry.metric,
        aggregation: entry.aggregation,
        groupBy: [],
        startTime: new Date(SINCE).toISOString(),
        endTime: new Date(UNTIL).toISOString(),
        granularity: { minutes: 1 },
      },
      summary: value === undefined ? [] : [{ [rollupColumn(entry)]: value }],
      data: value === undefined ? [] : [{ timestamp: new Date(SINCE).toISOString() }],
    },
    null,
    2,
  )
}

/** Erro real do CLI no Hobby para janela de mais de 30 minutos (2026-11-25). */
const PAYMENT_REQUIRED = JSON.stringify({
  error: {
    code: 'payment_required',
    message:
      'Observability Plus is required for function invocations that start more than 30 minutes ago.',
    hint: 'Observability Plus is available on Pro and Enterprise.',
    retryable: false,
  },
})

describe('parseMetricsOutput', () => {
  it('lê o total do resumo e converte para a unidade da cota', () => {
    assert.equal(
      parseMetricsOutput(metricsJson(source('active_cpu'), 7_200_000), source('active_cpu')),
      2,
    )
    assert.equal(
      parseMetricsOutput(
        metricsJson(source('fast_origin_transfer'), 2.5e9),
        source('fast_origin_transfer'),
      ),
      2.5,
    )
    assert.equal(
      parseMetricsOutput(
        metricsJson(source('function_invocations'), 42),
        source('function_invocations'),
      ),
      42,
    )
  })

  it('janela sem invocação (resumo vazio ou null) vale 0', () => {
    assert.equal(parseMetricsOutput(metricsJson(source('active_cpu')), source('active_cpu')), 0)
    assert.equal(
      parseMetricsOutput(metricsJson(source('active_cpu'), null), source('active_cpu')),
      0,
    )
  })

  it('erro do CLI, saída sem JSON e formato novo são falha', () => {
    assert.throws(
      () => parseMetricsOutput(PAYMENT_REQUIRED, source('active_cpu')),
      /payment_required: Observability Plus is required/u,
    )
    assert.throws(
      () => parseMetricsOutput('Error: not authorized', source('active_cpu')),
      /não é JSON/u,
    )
    assert.throws(() => parseMetricsOutput('{"data":[]}', source('active_cpu')), /sem "summary"/u)
    assert.throws(
      () => parseMetricsOutput('{"summary":[{"outra_coluna":1}]}', source('active_cpu')),
      /resumo sem a coluna vercel_function_invocation_function_cpu_time_ms_sum/u,
    )
  })
})

describe('planWindow', () => {
  it('primeira execução: os últimos 27 minutos menos 5 de atraso', () => {
    assert.equal(LOOKBACK_MINUTES, 27)
    assert.equal(LAG_MINUTES, 5)
    assert.deepEqual(planWindow(NOW), { since: SINCE, until: UNTIL })
  })

  it('continua do fim da anterior e nunca volta além do que o Hobby aceita', () => {
    const previous = Date.parse('2026-11-18T09:30:00.000Z')
    assert.deepEqual(planWindow(NOW, previous), { since: previous, until: UNTIL })
    assert.deepEqual(planWindow(NOW, SINCE - 3 * 60 * MINUTE), { since: SINCE, until: UNTIL })
  })

  it('menos de um minuto novo: nada a ler', () => {
    assert.equal(planWindow(NOW, UNTIL), undefined)
  })
})

describe('estado e estimativa', () => {
  it('soma as janelas por dia, descarta o que saiu dos 30 dias e estima com cobertura total', () => {
    let state = addWindow(undefined, { since: SINCE, until: UNTIL }, { active_cpu: 0.5 })
    state = addWindow(
      state,
      { since: UNTIL, until: UNTIL + 10 * MINUTE },
      { active_cpu: 0.25, function_invocations: 100 },
    )
    assert.equal(state.days.length, 1)
    assert.deepEqual(state.days[0], {
      day: '2026-11-18',
      coveredMinutes: 32,
      used: { active_cpu: 0.75, function_invocations: 100 },
    })
    const estimate = estimateUsage(state)
    assert.equal(estimate.coverage, 1)
    const cpu = estimate.ratios.find((ratio) => ratio.resource === 'active_cpu')
    assert.equal(cpu?.used, 0.75)
    assert.equal(cpu?.ratio, 0.75 / 4)
    // 31 dias depois, o dia de 18/11 sai da janela.
    const later = addWindow(
      state,
      { since: SINCE + 31 * DAY, until: UNTIL + 31 * DAY },
      { active_cpu: 0 },
    )
    assert.deepEqual(
      later.days.map((day) => day.day),
      ['2026-12-19'],
    )
  })

  it('lacuna (cron atrasado, falha) é extrapolada pela média do que foi lido', () => {
    let state = addWindow(undefined, { since: SINCE, until: UNTIL }, { active_cpu: 0.2 })
    // Duas horas sem leitura e mais 22 minutos lidos: 44 de 164 minutos acompanhados.
    const next = UNTIL + 2 * 60 * MINUTE
    state = addWindow(state, { since: next, until: next + 22 * MINUTE }, { active_cpu: 0.2 })
    const estimate = estimateUsage(state)
    assert.equal(Math.round(estimate.coverage * 1000) / 1000, Math.round((44 / 164) * 1000) / 1000)
    const cpu = estimate.ratios.find((ratio) => ratio.resource === 'active_cpu')
    assert.equal(cpu?.measured, 0.4)
    assert.ok(Math.abs((cpu?.used ?? 0) - 0.4 * (164 / 44)) < 1e-9)
  })

  it('só os recursos com fonte entram na estimativa', () => {
    const estimate = estimateUsage(addWindow(undefined, { since: SINCE, until: UNTIL }, {}))
    assert.deepEqual(
      estimate.ratios.map((ratio) => ratio.resource),
      ['active_cpu', 'provisioned_memory', 'function_invocations', 'fast_origin_transfer'],
    )
    for (const ratio of estimate.ratios) {
      assert.ok(HOBBY_QUOTAS.some((quota) => quota.resource === ratio.resource))
    }
  })

  it('parseState aceita o que addWindow grava e recusa formato desconhecido', () => {
    const state = addWindow(undefined, { since: SINCE, until: UNTIL }, { active_cpu: 0.1 })
    assert.deepEqual(parseState(JSON.stringify(state)), state)
    assert.throws(() => parseState('{"schemaVersion":2}'), /formato desconhecido/u)
    assert.throws(
      () =>
        parseState(
          JSON.stringify({ ...state, days: [{ day: 'ontem', coveredMinutes: 1, used: {} }] }),
        ),
      /dia ilegível/u,
    )
  })
})

describe('levelFor', () => {
  it('85% liga o kill switch; 95% o lockdown', () => {
    assert.equal(levelFor(0.849), 'none')
    assert.equal(levelFor(0.85), 'kill-switch')
    assert.equal(levelFor(0.949), 'kill-switch')
    assert.equal(levelFor(0.95), 'lockdown')
  })
})

describe('parseOptions', () => {
  it('modo diário, exercício e volta', () => {
    assert.deepEqual(parseOptions([]), { dryRun: false, release: false })
    assert.deepEqual(parseOptions(['--force-threshold', '0.95', '--only', 'staging']), {
      dryRun: false,
      release: false,
      forceThreshold: 0.95,
      only: 'staging',
    })
    assert.deepEqual(parseOptions(['--release', '--dry-run']), { dryRun: true, release: true })
  })

  it('recusa limiar fora da lista, --only sem modo manual e modos juntos', () => {
    assert.throws(() => parseOptions(['--force-threshold', '0.5']), /0.85 ou 0.95/u)
    assert.throws(() => parseOptions(['--only', 'staging']), /--only só vale/u)
    assert.throws(() => parseOptions(['--only', 'dev', '--release']), /staging ou production/u)
    assert.throws(() => parseOptions(['--release', '--force-threshold', '0.85']), /exclusivos/u)
  })
})

interface Call {
  readonly method: string
  readonly path: string
  readonly query: string
  readonly body?: unknown
}

interface FakeVercel {
  /**
   * `LLM_KILL_SWITCH` por projeto: `undefined` = não existe. Sem `type`, é `encrypted` e a listagem
   * devolve o valor cifrado (como a Vercel fez no exercício da F7); o claro sai do GET por id.
   */
  readonly killSwitch: Record<
    string,
    { value: string; updatedAt: number; type?: 'plain' | 'encrypted' } | undefined
  >
  /** Deployment de produção atual por domínio (`undefined` = 404). */
  readonly production: Record<string, { id: string; createdAt: number } | undefined>
  /** Estados devolvidos a cada GET da deployment nova. */
  readonly states?: string[]
}

function fakeDeps(
  env: RunDeps['env'],
  vercel: FakeVercel,
  exec: (args: readonly string[]) => ExecResult = () => ({ code: 0, stdout: '', stderr: '' }),
  files: readonly string[] = [VERCEL_CLI, FIREWALL_SCRIPT],
  state?: string,
): RunDeps & {
  calls: Call[]
  execs: { args: readonly string[]; env: Record<string, string> }[]
  lines: string[]
  written: string[]
} {
  const calls: Call[] = []
  const execs: { args: readonly string[]; env: Record<string, string> }[] = []
  const lines: string[] = []
  const written: string[] = []
  const states = [...(vercel.states ?? ['READY'])]
  let created = 0
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  return {
    env,
    now: NOW,
    calls,
    execs,
    lines,
    written,
    log: (line) => lines.push(line),
    sleep: async () => {},
    fileExists: (path) => files.includes(path),
    readFile: (path) => (path === STATE_FILE ? state : undefined),
    writeFile: (path, content) => {
      assert.equal(path, STATE_FILE)
      written.push(content)
    },
    deployTimeoutMs: 30_000,
    exec: async (_file, args, childEnv) => {
      execs.push({ args, env: { ...childEnv } })
      return exec(args)
    },
    fetch: (async (input: URL | string, init?: RequestInit) => {
      const url = new URL(String(input))
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      calls.push({
        method,
        path: url.pathname,
        query: url.search,
        ...(body === undefined ? {} : { body }),
      })
      if (url.hostname !== 'api.vercel.com') {
        return new Response('{}')
      }
      assert.equal(url.searchParams.get('teamId'), ORG)
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer vercel-token')
      const envMatch = /^\/v10\/projects\/(prj_\w+)\/env$/u.exec(url.pathname)
      if (envMatch && method === 'GET') {
        const current = vercel.killSwitch[envMatch[1] ?? '']
        if (current === undefined) {
          return json({ envs: [{ key: 'APP_ENV', value: 'staging', target: ['production'] }] })
        }
        const plain = current.type === 'plain'
        return json({
          envs: [
            {
              id: 'env_kill',
              key: 'LLM_KILL_SWITCH',
              target: ['production'],
              type: current.type ?? 'encrypted',
              updatedAt: current.updatedAt,
              decrypted: plain,
              value: plain ? current.value : 'eyJ2IjoiY2lmcmFkbyJ9',
            },
          ],
        })
      }
      const envById = /^\/v1\/projects\/(prj_\w+)\/env\/env_kill$/u.exec(url.pathname)
      if (envById && method === 'GET') {
        const current = vercel.killSwitch[envById[1] ?? '']
        return current === undefined
          ? json({ error: { code: 'not_found', message: 'env not found' } }, 404)
          : json({ id: 'env_kill', key: 'LLM_KILL_SWITCH', decrypted: true, value: current.value })
      }
      if (envMatch && method === 'POST') {
        return json({ created: [{ key: 'LLM_KILL_SWITCH' }] }, 201)
      }
      if (url.pathname === '/v13/deployments' && method === 'POST') {
        created += 1
        return json({
          id: `dpl_new${String(created)}`,
          createdAt: NOW.getTime(),
          readyState: 'QUEUED',
        })
      }
      const deployment = /^\/v13\/deployments\/(.+)$/u.exec(url.pathname)?.[1] ?? ''
      if (deployment.startsWith('dpl_new')) {
        return json({
          id: deployment,
          createdAt: NOW.getTime(),
          readyState: states.shift() ?? 'READY',
        })
      }
      if (deployment.endsWith('.vercel.app')) {
        const current = vercel.production[deployment]
        return current === undefined
          ? json({ error: { code: 'not_found', message: 'Deployment not found' } }, 404)
          : json({ ...current, name: deployment.replace('.vercel.app', '') })
      }
      if (/^\/v10\/projects\/prj_\w+\/promote\//u.test(url.pathname)) {
        return new Response(null, { status: 201 })
      }
      return json({ error: { code: 'unexpected', message: url.pathname } }, 500)
    }) as typeof fetch,
  }
}

const BASE_ENV = { VERCEL_TOKEN: 'vercel-token', VERCEL_ORG_ID: ORG, ...OTLP }
const OLD = Date.parse('2026-11-01T00:00:00Z')
const OLDER = Date.parse('2026-10-01T00:00:00Z')
const BOTH_LIVE: FakeVercel['production'] = {
  'tekoia-staging.vercel.app': { id: 'dpl_stg', createdAt: OLD },
  'tekoia.vercel.app': { id: 'dpl_prod', createdAt: OLD },
}

/**
 * `vercel metrics` de mentira: valor por recurso, na unidade da métrica (ms, GB-h, contagem, bytes);
 * recurso ausente responde janela vazia.
 */
function metricsExec(values: Readonly<Record<string, number>> = {}) {
  return (args: readonly string[]): ExecResult => {
    if (args[1] !== 'metrics') {
      return { code: 0, stdout: 'ok', stderr: '' }
    }
    const entry = USAGE_SOURCES.find((candidate) => candidate.metric === args[2])
    assert.ok(entry, `métrica inesperada: ${String(args[2])}`)
    return {
      code: 0,
      stdout: metricsJson(entry, values[entry.resource]),
      stderr: '',
    }
  }
}

/** Estado com um dia inteiro lido até o início da janela de NOW (cobertura total). */
function fullState(used: Readonly<Record<string, number>>): string {
  const state: UsageState = {
    schemaVersion: 1,
    trackingSince: SINCE - DAY,
    coveredUntil: SINCE,
    days: [{ day: '2026-11-17', coveredMinutes: 1440, used }],
  }
  return JSON.stringify(state)
}

function writes(calls: readonly Call[]): string[] {
  return calls
    .filter((call) => call.method !== 'GET' && !call.path.endsWith('/v1/metrics'))
    .map((call) => `${call.method} ${call.path}`)
}

describe('run', () => {
  it('sem VERCEL_USAGE_TOKEN: avisa, não chama nada e sai com 0', async () => {
    const d = fakeDeps({}, { killSwitch: {}, production: {} })
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0)
    assert.deepEqual(d.calls, [])
    assert.deepEqual(d.execs, [])
    assert.match(d.lines[0] ?? '', /^::warning title=vercel-usage::sem VERCEL_USAGE_TOKEN/u)
  })

  it('token sem VERCEL_ORG_ID é falha de configuração', async () => {
    const d = fakeDeps({ VERCEL_TOKEN: 'vercel-token' }, { killSwitch: {}, production: {} })
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 1)
    assert.deepEqual(d.execs, [])
  })

  it('uso baixo: lê a janela das quatro métricas, grava o estado e envia as razões e o sucesso', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec({ active_cpu: 360_000, function_invocations: 1200, fast_origin_transfer: 5e7 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.deepEqual(
      d.execs.map((exec) => exec.args[2]),
      USAGE_SOURCES.map((entry) => entry.metric),
    )
    assert.deepEqual(d.execs[0]?.args.slice(1), [
      'metrics',
      'vercel.function_invocation.function_cpu_time_ms',
      '--all',
      '--aggregation',
      'sum',
      '--since',
      '2026-11-18T09:18:00.000Z',
      '--until',
      '2026-11-18T09:40:00.000Z',
      '--granularity',
      '1m',
      '--json',
      '--scope',
      ORG,
    ])
    assert.equal(d.execs[2]?.args[5], 'count')
    // O CLI recebe o token e o time, e nada da credencial OTLP.
    assert.equal(d.execs[0]?.env['VERCEL_TOKEN'], 'vercel-token')
    assert.equal(d.execs[0]?.env['GRAFANA_OTLP_TOKEN'], undefined)
    assert.deepEqual(writes(d.calls), [])
    assert.equal(d.written.length, 1)
    const state = parseState(d.written[0] ?? '')
    assert.equal(state.coveredUntil, UNTIL)
    assert.deepEqual(state.days[0]?.used, {
      active_cpu: 0.1,
      provisioned_memory: 0,
      function_invocations: 1200,
      fast_origin_transfer: 0.05,
    })
    const otlp = d.calls.filter((call) => call.path === '/otlp/v1/metrics')
    assert.equal(otlp.length, 1)
    const sent = JSON.stringify(otlp[0]?.body)
    assert.ok(sent.includes('teko_vercel_usage_ratio'))
    assert.ok(sent.includes('"stringValue":"vercel-usage"'))
    assert.ok(!sent.includes('cdn_requests'))
    assert.ok(
      result.summary.some((line) => line.includes('| active_cpu | 0.1 h | 0.1 h | 4 h | 2.5% |')),
    )
    assert.ok(result.summary.some((line) => line.includes('| cdn_requests | sem fonte no Hobby |')))
    assert.ok(result.summary.some((line) => line.startsWith('Cobertura: 100%')))
  })

  it('continua do estado anterior e soma a janela nova', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec({ active_cpu: 3_600_000 }),
      undefined,
      fullState({ active_cpu: 1 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    const state = parseState(d.written[0] ?? '')
    assert.equal(state.trackingSince, SINCE - DAY)
    assert.deepEqual(
      state.days.map((day) => [day.day, day.used['active_cpu']]),
      [
        ['2026-11-17', 1],
        ['2026-11-18', 1],
      ],
    )
    assert.ok(
      result.summary.some((line) => line.includes('| active_cpu | 2 h | 2 h | 4 h | 50% |')),
    )
  })

  it('85%: grava o kill switch e redeploya a produção atual dos dois projetos', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE, states: ['BUILDING', 'READY'] },
      metricsExec(),
      undefined,
      fullState({ provisioned_memory: 306 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.deepEqual(writes(d.calls), [
      `POST /v10/projects/${STAGING}/env`,
      'POST /v13/deployments',
      `POST /v10/projects/${STAGING}/promote/dpl_new1`,
      `POST /v10/projects/${PROD}/env`,
      'POST /v13/deployments',
      `POST /v10/projects/${PROD}/promote/dpl_new2`,
    ])
    const upsert = d.calls.find((call) => call.method === 'POST' && call.path.endsWith('/env'))
    assert.equal(upsert?.query.includes('upsert=true'), true)
    assert.deepEqual(
      { ...(upsert?.body as Record<string, unknown>), comment: undefined },
      {
        key: 'LLM_KILL_SWITCH',
        value: 'true',
        type: 'plain',
        target: ['production'],
        comment: undefined,
      },
    )
    const deploy = d.calls.find((call) => call.path === '/v13/deployments')
    assert.deepEqual(deploy?.body, {
      deploymentId: 'dpl_stg',
      name: 'tekoia-staging',
      target: 'production',
    })
    assert.ok(deploy?.query.includes('forceNew=1'))
    // Sem lockdown abaixo de 95%.
    assert.equal(d.execs.filter((exec) => exec.args[0] === FIREWALL_SCRIPT).length, 0)
  })

  it('85% com o kill switch já ligado e aplicado: não grava nem redeploya (idempotente)', async () => {
    const d = fakeDeps(
      BASE_ENV,
      {
        killSwitch: {
          [STAGING]: { value: 'true', updatedAt: OLDER },
          [PROD]: { value: 'true', updatedAt: OLDER },
        },
        production: BOTH_LIVE,
      },
      metricsExec(),
      undefined,
      fullState({ active_cpu: 3.6 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0)
    assert.deepEqual(writes(d.calls), [])
    assert.ok(d.lines.some((line) => line.includes('tekoia: LLM_KILL_SWITCH já está ligado')))
  })

  it('kill switch ligado depois da deployment atual (redeploy anterior falhou): só redeploya', async () => {
    const d = fakeDeps(BASE_ENV, {
      killSwitch: { [STAGING]: { value: 'true', updatedAt: NOW.getTime() } },
      production: BOTH_LIVE,
    })
    const result = await run(d, {
      dryRun: false,
      release: false,
      forceThreshold: 0.85,
      only: 'staging',
    })
    assert.equal(result.code, 0)
    assert.deepEqual(writes(d.calls), [
      'POST /v13/deployments',
      `POST /v10/projects/${STAGING}/promote/dpl_new1`,
    ])
  })

  it('95%: lockdown pelo vercel-firewall.ts e kill switch, nos dois projetos', async () => {
    // 940 mil lidas + 20 mil na janela: 96% das invocações.
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec({ function_invocations: 20_000 }),
      undefined,
      fullState({ function_invocations: 940_000 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    const firewall = d.execs.filter((exec) => exec.args[0] === FIREWALL_SCRIPT)
    assert.deepEqual(
      firewall.map((exec) => exec.args.slice(1).join(' ')),
      ['--env staging --lockdown on', '--env production --lockdown on'],
    )
    assert.equal(firewall[0]?.env['VERCEL_ORG_ID'], ORG)
    assert.equal(writes(d.calls).filter((call) => call === 'POST /v13/deployments').length, 2)
  })

  it('exercício no staging (--force-threshold 0.95 --only staging): não lê uso nem envia métrica', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE })
    const result = await run(d, {
      dryRun: false,
      release: false,
      forceThreshold: 0.95,
      only: 'staging',
    })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.deepEqual(
      d.execs.map((exec) => exec.args.slice(1).join(' ')),
      ['--env staging --lockdown on'],
    )
    assert.ok(!d.calls.some((call) => call.path.includes(PROD)))
    assert.ok(!d.calls.some((call) => call.path.endsWith('/v1/metrics')))
  })

  it('dry-run: só lê e mostra o plano, e passa --dry-run ao firewall', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE })
    const result = await run(d, {
      dryRun: true,
      release: false,
      forceThreshold: 0.95,
      only: 'staging',
    })
    assert.equal(result.code, 0)
    assert.deepEqual(writes(d.calls), [])
    assert.deepEqual(d.execs[0]?.args.slice(1), [
      '--env',
      'staging',
      '--lockdown',
      'on',
      '--dry-run',
    ])
    assert.ok(result.summary.some((line) => line.includes('gravar LLM_KILL_SWITCH=true')))
    assert.ok(
      result.summary.some((line) => line.includes('redeploy da deployment de produção dpl_stg')),
    )
  })

  it('--release desliga o kill switch com redeploy e o lockdown', async () => {
    const d = fakeDeps(BASE_ENV, {
      killSwitch: { [STAGING]: { value: 'true', updatedAt: OLDER } },
      production: BOTH_LIVE,
    })
    const result = await run(d, { dryRun: false, release: true, only: 'staging' })
    assert.equal(result.code, 0, d.lines.join('\n'))
    const upsert = d.calls.find((call) => call.method === 'POST' && call.path.endsWith('/env'))
    assert.equal((upsert?.body as { value?: string } | undefined)?.value, 'false')
    assert.deepEqual(
      d.execs.map((exec) => exec.args.slice(1).join(' ')),
      ['--env staging --lockdown off'],
    )
  })

  it('variável encrypted vem cifrada na listagem: lê o valor pelo GET por id', async () => {
    const d = fakeDeps(BASE_ENV, {
      killSwitch: { [STAGING]: { value: 'true', updatedAt: OLDER } },
      production: BOTH_LIVE,
    })
    const result = await run(d, { dryRun: true, release: true, only: 'staging' })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.ok(d.calls.some((call) => call.path === `/v1/projects/${STAGING}/env/env_kill`))
    assert.ok(result.summary.some((line) => line.includes('gravar LLM_KILL_SWITCH=false')))
  })

  it('variável plain: usa o valor da listagem, sem o GET por id', async () => {
    const d = fakeDeps(BASE_ENV, {
      killSwitch: { [STAGING]: { value: 'true', updatedAt: OLDER, type: 'plain' } },
      production: BOTH_LIVE,
    })
    const result = await run(d, { dryRun: true, release: true, only: 'staging' })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.ok(!d.calls.some((call) => call.path.startsWith('/v1/projects/')))
    assert.ok(result.summary.some((line) => line.includes('gravar LLM_KILL_SWITCH=false')))
  })

  it('valor ilegível (nem true nem false) é falha, sem gravar nem redeployar', async () => {
    const d = fakeDeps(BASE_ENV, {
      killSwitch: { [STAGING]: { value: 'talvez', updatedAt: OLDER, type: 'plain' } },
      production: BOTH_LIVE,
    })
    const result = await run(d, { dryRun: false, release: true, only: 'staging' })
    assert.notEqual(result.code, 0)
    assert.deepEqual(writes(d.calls), [])
    assert.ok(d.lines.some((line) => line.includes('valor ilegível')))
  })

  it('--release sem a variável não redeploya', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE })
    const result = await run(d, { dryRun: false, release: true, only: 'production' })
    assert.equal(result.code, 0)
    assert.deepEqual(writes(d.calls), [])
  })

  it('projeto sem deployment de produção: grava a variável e avisa', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: {} })
    const result = await run(d, {
      dryRun: false,
      release: false,
      forceThreshold: 0.85,
      only: 'production',
    })
    assert.equal(result.code, 0)
    assert.deepEqual(writes(d.calls), [`POST /v10/projects/${PROD}/env`])
    assert.ok(d.lines.some((line) => line.includes('vale no próximo deploy')))
  })

  it('deployment nova em ERROR deixa o job vermelho sem pular o outro projeto', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE, states: ['ERROR'] })
    const result = await run(d, { dryRun: false, release: false, forceThreshold: 0.85 })
    assert.equal(result.code, 1)
    assert.ok(
      d.lines.includes(
        '::error title=vercel-usage::tekoia-staging: a deployment dpl_new1 terminou em ERROR',
      ),
    )
    assert.ok(writes(d.calls).includes(`POST /v10/projects/${PROD}/env`))
  })

  it('sem o vercel-firewall.ts no checkout, o lockdown falha com mensagem clara', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE }, undefined, [VERCEL_CLI])
    const result = await run(d, {
      dryRun: false,
      release: false,
      forceThreshold: 0.95,
      only: 'staging',
    })
    assert.equal(result.code, 1)
    assert.ok(d.lines.some((line) => line.includes('scripts/vercel-firewall.ts não existe')))
  })

  it('CLI com erro: job vermelho, sem sucesso registrado, sem gravar o estado e sem agir', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      () => ({
        code: 1,
        stdout: '',
        stderr: 'Error: ::set-output forbidden',
      }),
      undefined,
      fullState({ active_cpu: 3.9 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 1)
    assert.deepEqual(writes(d.calls), [])
    assert.deepEqual(d.written, [])
    // A saída do filho não vira comando do Actions.
    assert.ok(d.lines.includes('  Error: : :set-output forbidden'))
    const otlp = d.calls.find((call) => call.path === '/otlp/v1/metrics')
    assert.ok(!JSON.stringify(otlp?.body ?? {}).includes('vercel-usage'))
  })

  it('fonte recusada (payment_required do Hobby): falha visível, sem sucesso e estado intacto', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      (args) =>
        args[1] === 'metrics'
          ? { code: 1, stdout: PAYMENT_REQUIRED, stderr: '' }
          : { code: 0, stdout: 'ok', stderr: '' },
      undefined,
      fullState({ active_cpu: 1 }),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 1)
    assert.equal(d.execs.length, 1)
    assert.deepEqual(d.written, [])
    assert.ok(
      d.lines.some(
        (line) =>
          line.startsWith(
            '::error title=vercel-usage::fonte de uso não respondeu: vercel metrics',
          ) && line.includes('payment_required: Observability Plus is required'),
      ),
    )
    assert.ok(result.summary.some((line) => line.includes('A fonte de uso não respondeu')))
    const otlp = d.calls.find((call) => call.path === '/otlp/v1/metrics')
    const sent = JSON.stringify(otlp?.body ?? {})
    assert.ok(!sent.includes('teko_ops_job_last_success_timestamp_seconds'))
    assert.ok(!sent.includes('teko_vercel_usage_ratio'))
  })

  it('formato novo do vercel metrics é falha, não uso zero', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE }, (args) =>
      args[1] === 'metrics'
        ? { code: 0, stdout: '{"summary":[{"cpu":1}]}', stderr: '' }
        : { code: 0, stdout: 'ok', stderr: '' },
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 1)
    assert.deepEqual(d.written, [])
    assert.ok(d.lines.some((line) => line.includes('resumo sem a coluna')))
  })

  it('dry-run da medição: lê e mostra, sem gravar o estado nem enviar', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec({ active_cpu: 360_000 }),
    )
    const result = await run(d, { dryRun: true, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.equal(d.execs.length, USAGE_SOURCES.length)
    assert.deepEqual(d.written, [])
    assert.ok(!d.calls.some((call) => call.path === '/otlp/v1/metrics'))
  })

  it('estado ilegível: avisa e recomeça do zero', async () => {
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec(),
      undefined,
      '{"schemaVersion":9}',
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.ok(
      d.lines.some((line) => line.startsWith('::warning title=vercel-usage::estado ilegível')),
    )
    assert.equal(parseState(d.written[0] ?? '').trackingSince, SINCE)
  })

  it('cobertura baixa: avisa que a estimativa extrapola lacunas', async () => {
    const stale: UsageState = {
      schemaVersion: 1,
      trackingSince: SINCE - 2 * DAY,
      coveredUntil: SINCE - DAY,
      days: [{ day: '2026-11-16', coveredMinutes: 60, used: { active_cpu: 0.01 } }],
    }
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec(),
      undefined,
      JSON.stringify(stale),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0, d.lines.join('\n'))
    assert.ok(d.lines.some((line) => line.startsWith('::warning title=vercel-usage::cobertura de')))
  })

  it('sem minuto novo desde a última leitura: não chama o CLI e registra o sucesso', async () => {
    const state: UsageState = {
      schemaVersion: 1,
      trackingSince: SINCE,
      coveredUntil: UNTIL,
      days: [{ day: '2026-11-18', coveredMinutes: 22, used: {} }],
    }
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE },
      metricsExec(),
      undefined,
      JSON.stringify(state),
    )
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0)
    assert.deepEqual(d.execs, [])
    assert.deepEqual(d.written, [])
    const otlp = d.calls.find((call) => call.path === '/otlp/v1/metrics')
    assert.ok(
      JSON.stringify(otlp?.body ?? {}).includes('teko_ops_job_last_success_timestamp_seconds'),
    )
  })
})
