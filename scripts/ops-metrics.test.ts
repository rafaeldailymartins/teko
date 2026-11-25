import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMetricsPayload, pushMetrics } from './lib/otlp-metrics.ts'
import {
  coverageAgePoints,
  jobSuccessPoint,
  NEON_TRANSFER_QUOTA_BYTES,
  neonTransferRatio,
  neonUsagePoints,
  type RunDeps,
  run,
  todayInSaoPaulo,
  tokenExpiryPoints,
} from './ops-metrics.ts'

const NOW = new Date('2026-11-16T09:45:00.000Z')
const PROD = { name: 'teko-prod', environment: 'production' } as const

function pointValue(points: ReturnType<typeof neonUsagePoints>, name: string): number | undefined {
  return points.find((point) => point.name === name)?.value
}

describe('neonUsagePoints', () => {
  it('30 CU-h com 40% do período decorrido projetam 75 CU-h (ratio 0,75)', () => {
    const points = neonUsagePoints(
      PROD,
      {
        compute_time_seconds: 30 * 3600,
        data_transfer_bytes: 0,
        consumption_period_start: '2026-11-01T00:00:00Z',
        consumption_period_end: '2026-11-11T00:00:00Z',
      },
      new Date('2026-11-05T00:00:00Z'),
    )
    assert.equal(pointValue(points, 'teko_neon_compute_hours'), 30)
    assert.equal(pointValue(points, 'teko_neon_cu_hours_ratio'), 0.75)
    assert.deepEqual(points[0]?.labels, { project: 'teko-prod' })
    assert.equal(points[0]?.environment, 'production')
  })

  it('sem consumption_period_end usa um mês a partir do início', () => {
    const points = neonUsagePoints(
      PROD,
      {
        compute_time_seconds: 15 * 3600,
        data_transfer_bytes: 0,
        consumption_period_start: '2026-11-01T00:00:00Z',
      },
      new Date('2026-11-16T00:00:00Z'),
    )
    assert.equal(pointValue(points, 'teko_neon_cu_hours_ratio'), 0.3)
  })

  it('no primeiro dia do ciclo a fração decorrida tem piso de um dia', () => {
    const points = neonUsagePoints(
      PROD,
      {
        compute_time_seconds: 3600,
        data_transfer_bytes: 0,
        consumption_period_start: '2026-11-01T00:00:00Z',
        consumption_period_end: '2026-12-01T00:00:00Z',
      },
      new Date('2026-11-01T01:00:00Z'),
    )
    assert.equal(pointValue(points, 'teko_neon_cu_hours_ratio'), 0.3)
  })

  it('recusa período inválido', () => {
    assert.throws(
      () =>
        neonUsagePoints(
          PROD,
          { compute_time_seconds: 1, data_transfer_bytes: 0, consumption_period_start: 'x' },
          NOW,
        ),
      /consumption_period_start inválido/u,
    )
  })
})

describe('neonTransferRatio', () => {
  it('5,09 GB do staging em 2026-11-18 são 102% da cota de 5 GB do Free', () => {
    assert.equal(NEON_TRANSFER_QUOTA_BYTES, 5_000_000_000)
    assert.equal(neonTransferRatio(5_090_000_000), 1.018)
    assert.equal(neonTransferRatio(0), 0)
  })

  it('o ponto de transferência vai com o projeto e o ambiente, sem projeção', () => {
    const points = neonUsagePoints(
      PROD,
      {
        compute_time_seconds: 0,
        data_transfer_bytes: 4_000_000_000,
        consumption_period_start: '2026-11-01T00:00:00Z',
        consumption_period_end: '2026-12-01T00:00:00Z',
      },
      new Date('2026-11-02T00:00:00Z'),
    )
    assert.equal(pointValue(points, 'teko_neon_data_transfer_ratio'), 0.8)
    const point = points.find((entry) => entry.name === 'teko_neon_data_transfer_ratio')
    assert.deepEqual(point?.labels, { project: 'teko-prod' })
    assert.equal(point?.environment, 'production')
  })

  it('recusa valor negativo ou não finito', () => {
    assert.throws(() => neonTransferRatio(-1), RangeError)
    assert.throws(() => neonTransferRatio(Number.NaN), RangeError)
  })
})

describe('tokenExpiryPoints', () => {
  it('conta os dias até a data (negativo quando venceu)', () => {
    const points = tokenExpiryPoints(
      JSON.stringify({ 'VERCEL_TOKEN (staging)': '2026-12-16', VERCEL_USAGE_TOKEN: '2026-11-10' }),
      '2026-11-16',
    )
    assert.deepEqual(
      points.map((point) => [point.labels?.['token'], point.value]),
      [
        ['VERCEL_TOKEN (staging)', 30],
        ['VERCEL_USAGE_TOKEN', -6],
      ],
    )
  })

  it('recusa JSON que não é objeto, data inválida e nome com caractere estranho', () => {
    assert.throws(() => tokenExpiryPoints('[]', '2026-11-16'), /precisa ser um objeto/u)
    assert.throws(() => tokenExpiryPoints('{"A": "2026-02-30"}', '2026-11-16'), /data inválida/u)
    assert.throws(() => tokenExpiryPoints('{"A\\n": "2026-12-01"}', '2026-11-16'), /nome inválido/u)
    assert.throws(() => tokenExpiryPoints('nope', '2026-11-16'), /não é JSON/u)
  })
})

describe('coverageAgePoints', () => {
  const report = {
    schemaVersion: 1,
    generatedAt: '2026-11-16T09:40:00.000Z',
    databases: [
      {
        name: 'teko-prod',
        environment: 'production',
        families: [],
        missingSchema: true,
      },
      {
        name: 'teko-staging',
        environment: 'staging',
        families: [
          { family: 'rcte', verifiedAt: '2026-11-16' },
          { family: 'tabelas-go', verifiedAt: '2026-11-12' },
        ],
      },
    ],
  }

  it('idade em dias por família e ambiente', () => {
    const { points, errors } = coverageAgePoints(JSON.stringify(report), '2026-11-16')
    assert.deepEqual(errors, [])
    assert.deepEqual(
      points.map((point) => [point.environment, point.labels?.['family'], point.value]),
      [
        ['staging', 'rcte', 0],
        ['staging', 'tabelas-go', 4],
      ],
    )
  })

  it('erro de um banco vira falha, e as famílias do outro continuam', () => {
    const failed = {
      ...report,
      databases: [{ ...report.databases[0], error: 'conexão recusada' }, report.databases[1]],
    }
    const { points, errors } = coverageAgePoints(JSON.stringify(failed), '2026-11-16')
    assert.deepEqual(errors, ['teko-prod: conexão recusada'])
    assert.equal(points.length, 2)
  })

  it('recusa versão desconhecida', () => {
    assert.throws(() => coverageAgePoints('{"schemaVersion": 2}', '2026-11-16'), /desconhecido/u)
  })
})

describe('todayInSaoPaulo', () => {
  it('usa o fuso de São Paulo (02:00 UTC ainda é o dia anterior)', () => {
    assert.equal(todayInSaoPaulo(new Date('2026-11-17T02:00:00Z')), '2026-11-16')
  })
})

describe('buildMetricsPayload', () => {
  it('agrupa por ambiente, sem unit, com service.name e os labels ordenados', () => {
    const payload = buildMetricsPayload(
      [
        ...neonUsagePoints(
          PROD,
          {
            compute_time_seconds: 3600,
            data_transfer_bytes: 0,
            consumption_period_start: '2026-11-01T00:00:00Z',
          },
          NOW,
        ),
        jobSuccessPoint('quotas', NOW),
      ],
      { serviceName: 'teko-ops', now: NOW },
    ) as {
      resourceMetrics: {
        resource: { attributes: { key: string; value: { stringValue: string } }[] }
        scopeMetrics: { metrics: Record<string, unknown>[] }[]
      }[]
    }
    assert.equal(payload.resourceMetrics.length, 2)
    const [withoutEnv, production] = payload.resourceMetrics
    assert.deepEqual(withoutEnv?.resource.attributes, [
      { key: 'service.name', value: { stringValue: 'teko-ops' } },
    ])
    assert.deepEqual(production?.resource.attributes, [
      { key: 'deployment.environment.name', value: { stringValue: 'production' } },
      { key: 'service.name', value: { stringValue: 'teko-ops' } },
    ])
    const metrics = production?.scopeMetrics[0]?.metrics ?? []
    assert.deepEqual(
      metrics.map((metric) => metric['name']),
      ['teko_neon_compute_hours', 'teko_neon_cu_hours_ratio', 'teko_neon_data_transfer_ratio'],
    )
    for (const metric of metrics) {
      assert.equal('unit' in metric, false)
    }
    const gauge = metrics[0]?.['gauge'] as { dataPoints: unknown[] } | undefined
    assert.deepEqual(gauge?.dataPoints[0], {
      attributes: [{ key: 'project', value: { stringValue: 'teko-prod' } }],
      timeUnixNano: '1794822300000000000',
      asDouble: 1,
    })
  })

  it('recusa nome fora do padrão Prometheus e valor não finito', () => {
    const now = NOW
    assert.throws(
      () => buildMetricsPayload([{ name: 'teko.x', value: 1 }], { serviceName: 's', now }),
      /nome de métrica inválido/u,
    )
    assert.throws(
      () => buildMetricsPayload([{ name: 'teko_x', value: Number.NaN }], { serviceName: 's', now }),
      /não finito/u,
    )
  })
})

describe('pushMetrics', () => {
  it('POST em <endpoint>/v1/metrics com Basic auth e JSON', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fakeFetch = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('{}', { status: 200 })
    }) as typeof fetch
    await pushMetrics(
      { endpoint: 'https://otlp.example.grafana.net/otlp/', instanceId: '123', token: 'tok' },
      { resourceMetrics: [] },
      fakeFetch,
    )
    assert.equal(calls[0]?.url, 'https://otlp.example.grafana.net/otlp/v1/metrics')
    const headers = calls[0]?.init?.headers as Record<string, string>
    assert.equal(headers['authorization'], `Basic ${Buffer.from('123:tok').toString('base64')}`)
    assert.equal(headers['content-type'], 'application/json')
  })

  it('recusa endpoint sem https e falha com o status do gateway', async () => {
    await assert.rejects(
      pushMetrics({ endpoint: 'http://x', instanceId: '1', token: 't' }, {}),
      /https/u,
    )
    const fakeFetch = (async () => new Response('denied', { status: 401 })) as typeof fetch
    await assert.rejects(
      pushMetrics({ endpoint: 'https://x', instanceId: '1', token: 't' }, {}, fakeFetch),
      /OTLP respondeu 401: denied/u,
    )
  })
})

describe('run', () => {
  function deps(
    env: RunDeps['env'],
    responses: Record<string, Response>,
  ): RunDeps & {
    lines: string[]
    requests: string[]
  } {
    const lines: string[] = []
    const requests: string[] = []
    return {
      env,
      now: NOW,
      lines,
      requests,
      log: (line) => lines.push(line),
      fetch: (async (url: URL | string) => {
        const key = String(url)
        requests.push(key)
        return responses[key] ?? new Response('não encontrado', { status: 404 })
      }) as typeof fetch,
    }
  }

  it('environment vazio: só avisos, nada enviado, sai com 0 e com o ponto do job', async () => {
    const d = deps({}, {})
    const result = await run(d, { dryRun: false, job: 'quotas' })
    assert.equal(result.code, 0)
    assert.deepEqual(d.requests, [])
    assert.equal(d.lines.filter((line) => line.startsWith('::warning')).length, 5)
    assert.ok(result.summary.some((line) => line.includes('teko_ops_job_last_success')))
  })

  it('lê o Neon, envia ao OTLP e falha só pela fonte configurada que quebrou', async () => {
    const neon = (seconds: number) =>
      new Response(
        JSON.stringify({
          project: {
            compute_time_seconds: seconds,
            data_transfer_bytes: 2_500_000_000,
            consumption_period_start: '2026-11-01T00:00:00Z',
            consumption_period_end: '2026-12-01T00:00:00Z',
          },
        }),
      )
    const d = deps(
      {
        NEON_PROD_PROJECT_ID: 'prod-123',
        NEON_API_KEY_PROD: 'k1',
        NEON_STAGING_PROJECT_ID: 'stg-456',
        NEON_API_KEY_STAGING: 'k2',
        TOKEN_EXPIRY_DATES: '{"VERCEL_TOKEN (staging)": "2027-01-01"}',
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.grafana.net/otlp',
        GRAFANA_OTLP_INSTANCE_ID: '1',
        GRAFANA_OTLP_TOKEN: 't',
      },
      {
        'https://console.neon.tech/api/v2/projects/prod-123': neon(7200),
        'https://otlp.example.grafana.net/otlp/v1/metrics': new Response('{}'),
      },
    )
    const result = await run(d, { dryRun: false, job: 'quotas' })
    assert.equal(result.code, 1)
    assert.ok(
      d.lines.includes('::error title=ops-metrics::teko-staging: API do Neon respondeu 404'),
    )
    assert.deepEqual(d.requests, [
      'https://console.neon.tech/api/v2/projects/prod-123',
      'https://console.neon.tech/api/v2/projects/stg-456',
      'https://otlp.example.grafana.net/otlp/v1/metrics',
    ])
    // Com falha, o job não registra sucesso.
    assert.ok(!result.summary.some((line) => line.includes('teko_ops_job_last_success')))
  })

  it('chave sem ID de projeto é falha de configuração; dry-run não envia', async () => {
    const d = deps({ NEON_API_KEY_PROD: 'k1' }, {})
    const result = await run(d, { dryRun: true, job: 'quotas' })
    assert.equal(result.code, 1)
    assert.ok(d.lines.includes('::error title=ops-metrics::teko-prod: falta NEON_PROD_PROJECT_ID'))
    assert.deepEqual(d.requests, [])
  })

  it('successOnly: não lê fonte nenhuma e envia só o sucesso do job', async () => {
    const d = deps(
      {
        NEON_API_KEY_PROD: 'k1',
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.grafana.net/otlp',
        GRAFANA_OTLP_INSTANCE_ID: '1',
        GRAFANA_OTLP_TOKEN: 't',
      },
      { 'https://otlp.example.grafana.net/otlp/v1/metrics': new Response('{}') },
    )
    const result = await run(d, { dryRun: false, job: 'weekly-maintenance', successOnly: true })
    assert.equal(result.code, 0)
    assert.deepEqual(d.requests, ['https://otlp.example.grafana.net/otlp/v1/metrics'])
    assert.deepEqual(
      d.lines.filter((line) => line.startsWith('::')),
      [],
    )
    assert.ok(result.summary.some((line) => line.includes('ops_job=weekly-maintenance')))
  })

  it('falha no envio OTLP deixa o job vermelho', async () => {
    const d = deps(
      {
        GRAFANA_OTLP_ENDPOINT: 'https://otlp.example.grafana.net/otlp',
        GRAFANA_OTLP_INSTANCE_ID: '1',
        GRAFANA_OTLP_TOKEN: 't',
      },
      {},
    )
    const result = await run(d, { dryRun: false, job: 'weekly-maintenance', successOnly: true })
    assert.equal(result.code, 1)
    assert.ok(
      d.lines.some((line) => line.startsWith('::error title=ops-metrics::OTLP respondeu 404')),
    )
  })
})
