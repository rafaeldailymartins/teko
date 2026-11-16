/**
 * Gauges em OTLP/HTTP JSON para o gateway OTLP do Grafana Cloud, sem SDK (os jobs do `ops.yml`
 * empurram uma vez por dia e terminam; não há exportação periódica).
 *
 * Nomes: o Mimir converte `.` e `-` em `_` e só acrescenta sufixo de unidade quando o gauge traz
 * `unit`. Os gauges daqui vão **sem** `unit`, para chegar com o nome exato do contrato
 * (`teko_neon_cu_hours_ratio`, e não `..._ratio_ratio`). `service.name` vira o label `job` e,
 * como `deployment.environment.name`, é promovido a label (`service_name`,
 * `deployment_environment_name`) pelo Grafana Cloud.
 */

export interface GaugePoint {
  /** Nome Prometheus final (`teko_neon_compute_hours`). */
  readonly name: string
  readonly value: number
  /** Atributos do ponto (viram labels). */
  readonly labels?: Readonly<Record<string, string>>
  /** `production`, `staging` ou ausente (métrica sem ambiente, como a idade de um token). */
  readonly environment?: string
  readonly description?: string
}

export interface OtlpTarget {
  /** Endpoint da stack com `/otlp`, sem o caminho do sinal. */
  readonly endpoint: string
  readonly instanceId: string
  readonly token: string
}

const METRIC_NAME = /^[a-z_:][a-z0-9_:]*$/u

interface OtlpAttribute {
  readonly key: string
  readonly value: { readonly stringValue: string }
}

function attributes(record: Readonly<Record<string, string>>): OtlpAttribute[] {
  return Object.entries(record)
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([key, value]) => ({ key, value: { stringValue: value } }))
}

/**
 * Payload `ExportMetricsServiceRequest` (JSON): um `resourceMetrics` por ambiente, com
 * `service.name` fixo, e um `gauge` por nome de métrica.
 */
export function buildMetricsPayload(
  points: readonly GaugePoint[],
  options: { readonly serviceName: string; readonly now: Date },
): unknown {
  for (const point of points) {
    if (!METRIC_NAME.test(point.name)) {
      throw new RangeError(`nome de métrica inválido: ${point.name}`)
    }
    if (!Number.isFinite(point.value)) {
      throw new RangeError(`valor não finito em ${point.name}`)
    }
  }
  const timeUnixNano = `${String(options.now.getTime())}000000`
  const byEnvironment = Map.groupBy(points, (point) => point.environment ?? '')
  const resourceMetrics = [...byEnvironment.entries()]
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([environment, envPoints]) => {
      const resource = { 'service.name': options.serviceName }
      const byName = Map.groupBy(envPoints, (point) => point.name)
      return {
        resource: {
          attributes: attributes(
            environment === ''
              ? resource
              : { ...resource, 'deployment.environment.name': environment },
          ),
        },
        scopeMetrics: [
          {
            scope: { name: 'teko-ops' },
            metrics: [...byName.entries()].map(([name, metricPoints]) => ({
              name,
              ...(metricPoints[0]?.description === undefined
                ? {}
                : { description: metricPoints[0].description }),
              gauge: {
                dataPoints: metricPoints.map((point) => ({
                  attributes: attributes(point.labels ?? {}),
                  timeUnixNano,
                  asDouble: point.value,
                })),
              },
            })),
          },
        ],
      }
    })
  return { resourceMetrics }
}

/** `POST <endpoint>/v1/metrics` com Basic auth (instance ID e token de escrita de métricas). */
export async function pushMetrics(
  target: OtlpTarget,
  payload: unknown,
  doFetch: typeof fetch = fetch,
): Promise<void> {
  const url = new URL(`${target.endpoint.replace(/\/+$/u, '')}/v1/metrics`)
  if (url.protocol !== 'https:') {
    throw new RangeError('o endpoint OTLP precisa ser https')
  }
  const credentials = Buffer.from(`${target.instanceId}:${target.token}`).toString('base64')
  const response = await doFetch(url, {
    method: 'POST',
    headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300)
    throw new Error(`OTLP respondeu ${String(response.status)}: ${detail}`)
  }
}
