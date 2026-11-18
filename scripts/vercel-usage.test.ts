import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type ExecResult,
  FIREWALL_SCRIPT,
  HOBBY_QUOTAS,
  levelFor,
  parseOptions,
  parseUsageReport,
  type RunDeps,
  run,
  toQuotaUnit,
  usageRatios,
  VERCEL_CLI,
} from './vercel-usage.ts'

const NOW = new Date('2026-11-18T09:45:00.000Z')
const ORG = 'team_abc123'
const STAGING = 'prj_rgXwv6zcTTb1UPU1qkEMrAWu6hY5'
const PROD = 'prj_Oe6xdCbPyqiwfNcz1n2KvsCP09as'
const OTLP = {
  GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.grafana.net/otlp',
  GRAFANA_OTLP_INSTANCE_ID: '1',
  GRAFANA_OTLP_TOKEN: 'otlp-token',
}

/** Formato real do `vercel billing usage --json` (Vercel CLI 65.11.0, `serializeService`). */
function report(services: unknown[]): string {
  return JSON.stringify({
    period: { from: '2026-10-19', to: '2026-11-18' },
    context: 'teko',
    costUnit: 'USD',
    services,
    totals: { cost: 0 },
  })
}

const LOW_USAGE = report([
  {
    name: 'Fluid Provisioned Memory',
    product: 'fluidProvisionedMemory',
    quantity: 36,
    unit: 'GB-Hrs',
    cost: 0,
    included: true,
    category: 'usage',
  },
  { name: 'Fluid Active CPU', product: 'fluidActiveCpu', quantity: 0.4, unit: 'Hrs', cost: 0 },
  { name: 'Function Invocations', quantity: 60_000, cost: 0 },
  { name: 'Fast Data Transfer', quantity: 3300, unit: 'MB', cost: 0 },
  { name: 'Edge Requests', quantity: 220_000, unit: 'requests', cost: 0 },
])

describe('parseUsageReport', () => {
  it('lê services com nome, produto, quantidade e unidade', () => {
    const services = parseUsageReport(LOW_USAGE)
    assert.equal(services.length, 5)
    assert.deepEqual(services[0], {
      name: 'Fluid Provisioned Memory',
      product: 'fluidProvisionedMemory',
      quantity: 36,
      unit: 'GB-Hrs',
      category: 'usage',
    })
  })

  it('tolera texto antes do JSON e entradas sem quantidade numérica', () => {
    const raw = `Fetching usage...\n${report([
      { name: 'Fast Origin Transfer', usage: 1.5, unit: 'GB' },
      { name: 'Quebrado', quantity: 'muito' },
      'lixo',
    ])}\n`
    assert.deepEqual(parseUsageReport(raw), [
      { name: 'Fast Origin Transfer', quantity: 1.5, unit: 'GB' },
    ])
  })

  it('recusa saída sem JSON ou sem services', () => {
    assert.throws(() => parseUsageReport('Error: not authorized'), /não é JSON/u)
    assert.throws(() => parseUsageReport('{"totals":{}}'), /sem a lista "services"/u)
  })
})

describe('toQuotaUnit', () => {
  const quota = (resource: string) => {
    const found = HOBBY_QUOTAS.find((entry) => entry.resource === resource)
    assert.ok(found)
    return found
  }

  it('converte tempo, memória e transferência para a unidade da cota', () => {
    assert.equal(
      toQuotaUnit(quota('active_cpu'), { name: 'x', quantity: 7_200_000, unit: 'ms' }),
      2,
    )
    assert.equal(toQuotaUnit(quota('active_cpu'), { name: 'x', quantity: 90, unit: 'min' }), 1.5)
    assert.equal(
      toQuotaUnit(quota('provisioned_memory'), { name: 'x', quantity: 3600, unit: 'GB-s' }),
      1,
    )
    assert.equal(
      toQuotaUnit(quota('fast_data_transfer'), { name: 'x', quantity: 2500, unit: 'MB' }),
      2.5,
    )
  })

  it('contagem aceita unidade em palavra ou nenhuma; tempo sem unidade conhecida é erro', () => {
    assert.equal(
      toQuotaUnit(quota('function_invocations'), { name: 'x', quantity: 10, unit: 'Invocations' }),
      10,
    )
    assert.equal(toQuotaUnit(quota('cdn_requests'), { name: 'x', quantity: 3, unit: 'K' }), 3000)
    assert.throws(
      () => toQuotaUnit(quota('active_cpu'), { name: 'Active CPU', quantity: 1 }),
      /active_cpu: unidade desconhecida "\(nenhuma\)"/u,
    )
  })
})

describe('usageRatios', () => {
  it('soma por recurso, zera os ausentes e casa nome ou slug do produto', () => {
    const { ratios, failures, unknown } = usageRatios(parseUsageReport(LOW_USAGE))
    assert.deepEqual(failures, [])
    assert.deepEqual(unknown, [])
    const byResource = Object.fromEntries(ratios.map((ratio) => [ratio.resource, ratio.ratio]))
    assert.equal(byResource['provisioned_memory'], 0.1)
    assert.equal(byResource['active_cpu'], 0.1)
    assert.equal(byResource['function_invocations'], 0.06)
    assert.equal(byResource['fast_data_transfer'], 0.033)
    assert.equal(byResource['cdn_requests'], 0.22)
    assert.equal(byResource['fast_origin_transfer'], 0)
    assert.equal(ratios.length, HOBBY_QUOTAS.length)
  })

  it('unidade nova reprova só aquele recurso; sem cota fixada vira aviso', () => {
    const { ratios, failures, unknown } = usageRatios([
      { name: 'Active CPU', quantity: 5, unit: 'vCPU-fortnights' },
      { name: 'Blob Storage', quantity: 2, unit: 'GB' },
      { name: 'Pro Seat', quantity: 1, category: 'subscription' },
      { name: 'Fast Origin Transfer', quantity: 5, unit: 'GB' },
    ])
    assert.equal(failures.length, 1)
    assert.match(failures[0] ?? '', /active_cpu: unidade desconhecida/u)
    assert.deepEqual(unknown, ['Blob Storage'])
    assert.ok(!ratios.some((ratio) => ratio.resource === 'active_cpu'))
    assert.equal(ratios.find((ratio) => ratio.resource === 'fast_origin_transfer')?.ratio, 0.5)
  })

  it('relatório com linhas e nenhuma reconhecida é falha (formato mudou)', () => {
    const { failures } = usageRatios([{ name: 'Something Else', quantity: 1 }])
    assert.match(failures[0] ?? '', /nenhum recurso do relatório casou/u)
  })

  it('relatório vazio (conta sem uso) não é falha', () => {
    assert.deepEqual(usageRatios([]).failures, [])
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
  /** `LLM_KILL_SWITCH` por projeto: `undefined` = não existe. */
  readonly killSwitch: Record<string, { value: string; updatedAt: number } | undefined>
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
): RunDeps & {
  calls: Call[]
  execs: { args: readonly string[]; env: Record<string, string> }[]
  lines: string[]
} {
  const calls: Call[] = []
  const execs: { args: readonly string[]; env: Record<string, string> }[] = []
  const lines: string[] = []
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
    log: (line) => lines.push(line),
    sleep: async () => {},
    fileExists: (path) => files.includes(path),
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
        return json({
          envs:
            current === undefined
              ? [{ key: 'APP_ENV', value: 'staging', target: ['production'] }]
              : [{ key: 'LLM_KILL_SWITCH', target: ['production'], type: 'encrypted', ...current }],
        })
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

function usageExec(raw: string) {
  return (args: readonly string[]): ExecResult =>
    args.includes('billing')
      ? { code: 0, stdout: raw, stderr: 'Fetching usage' }
      : { code: 0, stdout: 'ok', stderr: '' }
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

  it('uso baixo: só mede e envia as razões e o sucesso, sem tocar nos projetos', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE }, usageExec(LOW_USAGE))
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 0)
    assert.equal(d.execs.length, 1)
    assert.deepEqual(d.execs[0]?.args.slice(1), [
      'billing',
      'usage',
      '--since',
      '30d',
      '--json',
      '--scope',
      ORG,
    ])
    // O CLI recebe o token e o time, e nada da credencial OTLP.
    assert.equal(d.execs[0]?.env['VERCEL_TOKEN'], 'vercel-token')
    assert.equal(d.execs[0]?.env['GRAFANA_OTLP_TOKEN'], undefined)
    assert.deepEqual(writes(d.calls), [])
    const otlp = d.calls.filter((call) => call.path === '/otlp/v1/metrics')
    assert.equal(otlp.length, 1)
    const sent = JSON.stringify(otlp[0]?.body)
    assert.ok(sent.includes('teko_vercel_usage_ratio'))
    assert.ok(sent.includes('"stringValue":"vercel-usage"'))
    assert.ok(result.summary.some((line) => line.includes('| cdn_requests | 220000 requests |')))
  })

  it('85%: grava o kill switch e redeploya a produção atual dos dois projetos', async () => {
    const usage = report([{ name: 'Fluid Provisioned Memory', quantity: 306, unit: 'GB-Hrs' }])
    const d = fakeDeps(
      BASE_ENV,
      { killSwitch: {}, production: BOTH_LIVE, states: ['BUILDING', 'READY'] },
      usageExec(usage),
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
        type: 'encrypted',
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
    const usage = report([{ name: 'Fluid Active CPU', quantity: 3.6, unit: 'Hrs' }])
    const d = fakeDeps(
      BASE_ENV,
      {
        killSwitch: {
          [STAGING]: { value: 'true', updatedAt: OLDER },
          [PROD]: { value: 'true', updatedAt: OLDER },
        },
        production: BOTH_LIVE,
      },
      usageExec(usage),
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
    const usage = report([{ name: 'Edge Requests', quantity: 960_000 }])
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE }, usageExec(usage))
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

  it('CLI com erro: job vermelho, sem sucesso registrado e sem agir', async () => {
    const d = fakeDeps(BASE_ENV, { killSwitch: {}, production: BOTH_LIVE }, () => ({
      code: 1,
      stdout: '',
      stderr: 'Error: ::set-output forbidden',
    }))
    const result = await run(d, { dryRun: false, release: false })
    assert.equal(result.code, 1)
    assert.deepEqual(writes(d.calls), [])
    // A saída do filho não vira comando do Actions.
    assert.ok(d.lines.includes('  Error: : :set-output forbidden'))
    const otlp = d.calls.find((call) => call.path === '/otlp/v1/metrics')
    assert.ok(!JSON.stringify(otlp?.body ?? {}).includes('vercel-usage'))
  })
})
