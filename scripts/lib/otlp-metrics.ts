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
  let base = target.endpoint
  while (base.endsWith('/')) {
    base = base.slice(0, -1)
  }
  const url = new URL(`${base}/v1/metrics`)
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

export interface PublishDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly now: Date
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
}

/** Valor não vazio de uma variável de ambiente (`undefined` se ausente ou em branco). */
export function envValue(env: PublishDeps['env'], name: string): string | undefined {
  const raw = env[name]?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

function describePoint(point: GaugePoint): string {
  const labels = Object.entries({
    ...(point.environment === undefined ? {} : { env: point.environment }),
    ...point.labels,
  })
    .map(([key, labelValue]) => `${key}=${labelValue}`)
    .join(', ')
  return `| ${point.name} | ${labels} | ${String(Math.round(point.value * 1000) / 1000)} |`
}

/**
 * Tabela do resumo e envio dos pontos de um job do `ops.yml`, com a credencial OTLP do
 * environment `ops` (`GRAFANA_OTLP_ENDPOINT`, `GRAFANA_OTLP_INSTANCE_ID`, `GRAFANA_OTLP_TOKEN`).
 * Dry-run imprime o payload; sem a credencial, avisa e não envia (não é falha). `ok` só é falso
 * quando o envio falhou.
 */
export async function publishPoints(
  points: readonly GaugePoint[],
  deps: PublishDeps,
  options: { readonly dryRun: boolean; readonly serviceName: string; readonly title: string },
): Promise<{ ok: boolean; summary: string[] }> {
  const summary = ['| Métrica | Labels | Valor |', '|---|---|---|', ...points.map(describePoint)]
  const endpoint = envValue(deps.env, 'GRAFANA_OTLP_ENDPOINT')
  const instanceId = envValue(deps.env, 'GRAFANA_OTLP_INSTANCE_ID')
  const token = envValue(deps.env, 'GRAFANA_OTLP_TOKEN')
  const payload = buildMetricsPayload(points, { serviceName: options.serviceName, now: deps.now })
  if (options.dryRun) {
    deps.log(JSON.stringify(payload, null, 2))
    summary.push('', 'Dry-run: nada foi enviado.')
  } else if (endpoint === undefined || instanceId === undefined || token === undefined) {
    deps.log(
      `::warning title=${options.title}::sem GRAFANA_OTLP_ENDPOINT, GRAFANA_OTLP_INSTANCE_ID ou ` +
        'GRAFANA_OTLP_TOKEN no environment ops: métricas calculadas e não enviadas',
    )
    summary.push('', 'Sem credencial OTLP: nada foi enviado.')
  } else if (points.length > 0) {
    try {
      await pushMetrics({ endpoint, instanceId, token }, payload, deps.fetch)
      summary.push('', `${String(points.length)} ponto(s) enviados ao Grafana Cloud.`)
    } catch (error) {
      deps.log(
        `::error title=${options.title}::${error instanceof Error ? error.message : String(error)}`,
      )
      return { ok: false, summary }
    }
  }
  return { ok: true, summary }
}

/** Uma linha por chamada: quebra de linha vinda de erro ou resposta não forja comando do Actions. */
export function logLine(line: string): void {
  console.log(line.replaceAll(/[\r\n]/gu, ' '))
}
