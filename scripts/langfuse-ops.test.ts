import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  desiredModels,
  isAllowedBaseUrl,
  type ModelDefinition,
  planModels,
  projectMonthlyUnits,
  type RunDeps,
  run,
} from './langfuse-ops.ts'

const NOW = new Date('2026-11-15T12:00:00.000Z')

describe('desiredModels', () => {
  it('um modelo por preço de tabela, em USD por token, com o padrão exato escapado', () => {
    const models = desiredModels()
    const groq = models.find((model) => model.modelName === 'openai/gpt-oss-120b')
    assert.ok(groq)
    assert.equal(groq.matchPattern, '(?i)^(openai\\/gpt\\-oss\\-120b)$')
    assert.ok(new RegExp(groq.matchPattern.replace('(?i)', ''), 'i').test('openai/gpt-oss-120b'))
    assert.equal(groq.unit, 'TOKENS')
    assert.deepEqual(groq.pricingTiers[0], {
      name: 'Standard',
      isDefault: true,
      priority: 0,
      conditions: [],
      prices: { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
    })
    assert.equal(groq.startDate, '2026-11-14T00:00:00.000Z')
    assert.equal(models.length, 3)
  })
})

describe('planModels', () => {
  const [first, second] = desiredModels() as [ModelDefinition, ModelDefinition]
  const existing = (model: ModelDefinition, id: string, overrides: object = {}) => ({
    id,
    modelName: model.modelName,
    matchPattern: model.matchPattern,
    isLangfuseManaged: false,
    pricingTiers: [{ isDefault: true, prices: { ...model.pricingTiers[0].prices } }],
    ...overrides,
  })

  it('cria o que falta e mantém o que já está igual', () => {
    const plan = planModels([existing(first, 'a')], [first, second])
    assert.deepEqual(plan.remove, [])
    assert.deepEqual(
      plan.create.map((model) => model.modelName),
      [second.modelName],
    )
  })

  it('preço ou padrão diferente: apaga o antigo e recria', () => {
    const plan = planModels(
      [
        existing(first, 'velho', {
          pricingTiers: [{ isDefault: true, prices: { input: 1, output: 1 } }],
        }),
        existing(second, 'padrao', { matchPattern: 'x' }),
      ],
      [first, second],
    )
    assert.deepEqual(plan.remove, ['velho', 'padrao'])
    assert.equal(plan.create.length, 2)
  })

  it('não toca os modelos gerenciados pelo Langfuse nem os de fora da tabela', () => {
    const plan = planModels(
      [
        existing(first, 'gerenciado', {
          isLangfuseManaged: true,
          pricingTiers: [{ isDefault: true, prices: { input: 9, output: 9 } }],
        }),
        { id: 'outro', modelName: 'gpt-4o', isLangfuseManaged: false },
      ],
      [first],
    )
    assert.deepEqual(plan.remove, [])
    assert.equal(plan.create.length, 1)
  })
})

describe('projectMonthlyUnits', () => {
  it('linear sobre o mês UTC: 14.500 units em 14,5 dias de 30 → 30.000', () => {
    const { from, projected } = projectMonthlyUnits(14_500, NOW)
    assert.equal(from.toISOString(), '2026-11-01T00:00:00.000Z')
    assert.equal(projected, 30_000)
  })

  it('piso de um dia no começo do mês', () => {
    assert.equal(projectMonthlyUnits(100, new Date('2026-12-01T06:00:00Z')).projected, 3100)
  })
})

describe('isAllowedBaseUrl', () => {
  it('https sempre; http só no Langfuse local', () => {
    assert.equal(isAllowedBaseUrl('https://cloud.langfuse.com'), true)
    assert.equal(isAllowedBaseUrl('http://localhost:3100'), true)
    assert.equal(isAllowedBaseUrl('http://127.0.0.1:3100'), true)
    assert.equal(isAllowedBaseUrl('http://langfuse.example'), false)
    assert.equal(isAllowedBaseUrl('não é url'), false)
  })
})

interface Call {
  readonly method: string
  readonly url: URL
  readonly body: unknown
}

/** Hosts exatos dos fakes (comparação por igualdade, não por sufixo). */
const GRAFANA_HOST = 'otlp-gateway-prod-sa-east-1.grafana.net'
const LANGFUSE_HOST = 'cloud.langfuse.com'

/** API do Langfuse falsa em memória: modelos, score configs, queues e a Metrics API v2. */
function fakeLangfuse(options: { readonly units?: number; readonly failModels?: boolean } = {}) {
  const calls: Call[] = []
  const state = {
    models: [] as { id: string; modelName: string }[],
    configs: [] as { id: string; name: string }[],
    queues: [] as { id: string; name: string }[],
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const doFetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    calls.push({ method, url, body })
    const route = `${method} ${url.pathname}`
    if (url.hostname === GRAFANA_HOST) {
      return new Response(null, { status: 204 })
    }
    if (route === 'GET /api/public/models') {
      return options.failModels
        ? json({ message: 'segredo' }, 500)
        : json({ data: state.models, meta: { totalPages: 1 } })
    }
    if (route === 'POST /api/public/models') {
      state.models.push({ ...body, id: `m${String(state.models.length)}` })
      return json({})
    }
    if (route === 'GET /api/public/score-configs') {
      return json({ data: state.configs, meta: { totalPages: 1 } })
    }
    if (route === 'POST /api/public/score-configs') {
      const config = { ...body, id: 'cfg-1' }
      state.configs.push(config)
      return json(config)
    }
    if (route === 'GET /api/public/annotation-queues') {
      return json({ data: state.queues, meta: { totalPages: 1 } })
    }
    if (route === 'POST /api/public/annotation-queues') {
      state.queues.push({ ...body, id: 'q-1' })
      return json({})
    }
    if (route === 'GET /api/public/v2/metrics') {
      const query = JSON.parse(url.searchParams.get('query') ?? '{}') as { view: string }
      return json({
        data: query.view === 'observations' ? [{ count_count: String(options.units ?? 0) }] : [],
      })
    }
    return json({}, 404)
  }) as typeof fetch
  return { doFetch, calls, state }
}

function deps(env: Record<string, string>, doFetch: typeof fetch) {
  const lines: string[] = []
  const value: RunDeps = { env, now: NOW, fetch: doFetch, log: (line) => lines.push(line) }
  return { deps: value, lines }
}

const PROD_KEYS = { LANGFUSE_PROD_PUBLIC_KEY: 'pk-lf-p', LANGFUSE_PROD_SECRET_KEY: 'sk-lf-p' }
const OTLP = {
  GRAFANA_OTLP_ENDPOINT: `https://${GRAFANA_HOST}/otlp`,
  GRAFANA_OTLP_INSTANCE_ID: '123',
  GRAFANA_OTLP_TOKEN: 'glc_x',
}

describe('run', () => {
  it('sem chaves: avisa, não chama o Langfuse e termina verde', async () => {
    const api = fakeLangfuse()
    const { deps: d, lines } = deps({}, api.doFetch)
    const result = await run(d, { dryRun: false })
    assert.equal(result.code, 0)
    assert.equal(api.calls.length, 0)
    assert.equal(lines.filter((line) => line.startsWith('::warning')).length, 2)
    assert.ok(result.summary.includes('Nenhuma métrica a enviar.'))
  })

  it('aplica modelos, score config e queue, e envia a projeção e o sucesso; segunda vez é idempotente', async () => {
    const api = fakeLangfuse({ units: 1450 })
    const { deps: d } = deps({ ...PROD_KEYS, ...OTLP }, api.doFetch)
    assert.equal((await run(d, { dryRun: false })).code, 0)
    assert.equal(api.state.models.length, 3)
    assert.deepEqual(
      api.state.configs.map((config) => config.name),
      ['user_feedback'],
    )
    const queue = api.calls.find(
      (call) => call.method === 'POST' && call.url.pathname === '/api/public/annotation-queues',
    )
    assert.ok(queue)
    assert.deepEqual((queue.body as { scoreConfigIds: string[] }).scoreConfigIds, ['cfg-1'])
    const push = api.calls.find((call) => call.url.hostname === GRAFANA_HOST)
    const metrics = JSON.stringify(push?.body)
    assert.ok(metrics.includes('teko_langfuse_units_projected'))
    // 1450 observations + 1450 raízes no fake (a mesma contagem nas duas consultas) em 14,5 dias.
    assert.ok(metrics.includes('"asDouble":6000'))
    assert.ok(metrics.includes('"stringValue":"langfuse"'))

    api.calls.length = 0
    assert.equal((await run(d, { dryRun: false })).code, 0)
    assert.equal(
      api.calls.filter((call) => call.method === 'POST' && call.url.hostname === LANGFUSE_HOST)
        .length,
      0,
    )
  })

  it('dry-run: só lê, sem escrever no Langfuse nem enviar', async () => {
    const api = fakeLangfuse()
    const { deps: d } = deps({ ...PROD_KEYS, ...OTLP }, api.doFetch)
    const result = await run(d, { dryRun: true })
    assert.equal(result.code, 0)
    assert.equal(api.calls.filter((call) => call.method !== 'GET').length, 0)
    assert.equal(
      api.calls.some((call) => call.url.hostname === GRAFANA_HOST),
      false,
    )
    assert.ok(result.summary.some((line) => line.includes('(dry-run)')))
  })

  it('falha numa fonte configurada: envia as units, sem o sucesso, e termina vermelho', async () => {
    const api = fakeLangfuse({ failModels: true, units: 10 })
    const { deps: d, lines } = deps({ ...PROD_KEYS, ...OTLP }, api.doFetch)
    const result = await run(d, { dryRun: false })
    assert.equal(result.code, 1)
    assert.ok(lines.some((line) => line.startsWith('::error') && line.includes('500')))
    assert.ok(!lines.join('\n').includes('segredo'))
    const push = JSON.stringify(api.calls.find((call) => call.url.hostname === GRAFANA_HOST)?.body)
    assert.ok(push.includes('teko_langfuse_units_projected'))
    assert.ok(!push.includes('teko_ops_job_last_success_timestamp_seconds'))
  })

  it('LANGFUSE_BASE_URL em http fora do localhost: erro, sem chamar nada', async () => {
    const api = fakeLangfuse()
    const { deps: d } = deps(
      { ...PROD_KEYS, LANGFUSE_BASE_URL: 'http://langfuse.example' },
      api.doFetch,
    )
    assert.equal((await run(d, { dryRun: false })).code, 1)
    assert.equal(api.calls.length, 0)
  })
})
