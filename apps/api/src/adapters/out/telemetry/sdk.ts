import { randomUUID } from 'node:crypto'
import FastifyOtel from '@fastify/otel'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { defaultResource, type Resource, resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs'
import {
  AggregationTemporality,
  MeterProvider,
  MetricReader,
  type PushMetricExporter,
} from '@opentelemetry/sdk-metrics'
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import type { FastifyPluginCallback } from 'fastify'
import { noopTelemetry, type Telemetry } from '#app/ports/telemetry.ts'
import { createOtelLogSink, type LogSink } from './log-sink.ts'
import { createOtelTelemetry } from './metrics.ts'
import { TekoSampler } from './sampler.ts'
import { TRACER_NAME } from './tracing.ts'

/**
 * SDK do OpenTelemetry (linha 2.x) da API, sem `@vercel/otel` e sem coletor
 * (`docs/architecture/observabilidade.md`):
 *
 * - **Traces:** `NodeTracerProvider` com o `TekoSampler` (sempre amostra, menos o `/healthz`),
 *   `BatchSpanProcessor` com exporter OTLP/HTTP direto ao Grafana Cloud e os processors extras
 *   (`spanProcessors`, o ponto de extensão do Langfuse) no mesmo provider, logo com o mesmo
 *   `trace_id`.
 * - **Métricas:** leitor sob demanda, em temporalidade delta, sem timer: exporta só no `flush`, no
 *   máximo uma vez por `metricsIntervalMs` por instância.
 * - **Logs:** `LoggerProvider` com exporter OTLP/HTTP (Loki), alimentado pelo pino (`logSink`).
 * - **Flush:** `flush()` roda o `forceFlush` de traces e logs (e das métricas, se venceu o
 *   intervalo); quem chama (o hook HTTP) o põe em `BackgroundTasks` com teto de 500 ms. Nada
 *   depende de timer de exportação: a instância da Vercel pausa entre requisições.
 *
 * Sem endpoint OTLP (CI, testes, dev sem a stack), nada é exportado: o provider de traces continua
 * registrado (o `trace_id` do `traceparent` e o `x-trace-id` funcionam igual), mas sem processor
 * de exportação, e métricas e logs ficam no-op.
 */

/** Intervalo mínimo entre duas exportações de métricas por instância (plano: 1 min). */
export const METRICS_EXPORT_INTERVAL_MS = 60_000
/** Teto de cada requisição de exportação OTLP (a tarefa pós-resposta tem 500 ms). */
const EXPORT_TIMEOUT_MS = 1000

interface OtlpTarget {
  /** Base OTLP/HTTP (`https://otlp-gateway-<região>.grafana.net/otlp`); os sinais vão em `/v1/*`. */
  readonly endpoint: string
  /** Headers de cada exportação (Grafana Cloud: `Authorization: Basic ...`). */
  readonly headers: Readonly<Record<string, string>>
}

interface TelemetryIdentity {
  readonly serviceVersion: string
  readonly gitSha: string
  readonly environment: string
  /** `VERCEL_REGION` em runtime na Vercel; `null` fora dela. */
  readonly region: string | null
}

/** Exporters no lugar dos OTLP (testes, com os exporters em memória do SDK). */
interface TelemetryExporters {
  readonly spans: SpanExporter
  readonly logs: LogRecordExporter
  readonly metrics: PushMetricExporter
}

export interface TelemetryOptions {
  readonly identity: TelemetryIdentity
  /** `null`: sem exportação (CI, testes, dev sem a stack local). */
  readonly otlp: OtlpTarget | null
  /**
   * Ponto de extensão: processors extras no mesmo provider de traces, depois do de exportação ao
   * Grafana (o `LangfuseSpanProcessor` do `add-llm-tracing-langfuse`). O `flush` e o `shutdown`
   * os alcançam pelo provider.
   */
  readonly spanProcessors?: readonly SpanProcessor[]
  readonly exporters?: TelemetryExporters
  /** Registra o provider como global (padrão `true`; os testes usam `false`). */
  readonly registerGlobal?: boolean
  readonly metricsIntervalMs?: number
  /**
   * Temporalidade das métricas (padrão `delta`, a da arquitetura). O Mimir (e o Prometheus do
   * `otel-lgtm`) recusa delta se a ingestão nativa de delta não estiver ligada; com `cumulative`,
   * cada instância é uma série própria (`service.instance.id`).
   */
  readonly metricsTemporality?: MetricsTemporality
  readonly nowMs?: () => number
}

export const MetricsTemporality = { Delta: 'delta', Cumulative: 'cumulative' } as const
export type MetricsTemporality = (typeof MetricsTemporality)[keyof typeof MetricsTemporality]

export interface TelemetryRuntime {
  /** Algum sinal sai do processo (endpoint configurado ou exporters injetados). */
  readonly exporting: boolean
  /** Porta de métricas para a aplicação (`noopTelemetry` sem exportação). */
  readonly telemetry: Telemetry
  /** Plugin do `@fastify/otel` (span `request` de cada requisição, com o contexto do `traceparent`). */
  readonly fastifyPlugin: FastifyPluginCallback
  /** Destino dos logs do pino no OTel (`null` sem exportação). */
  readonly logSink: LogSink | null
  readonly tracerProvider: NodeTracerProvider
  /** Exporta o que está pendente: traces, logs e, se venceu o intervalo, as métricas. Nunca rejeita. */
  flush(): Promise<void>
  /** Encerramento (SIGTERM): flush de tudo, métricas inclusive, e fim dos providers. */
  shutdown(): Promise<void>
}

/**
 * Leitor de métricas sem timer: coleta e exporta só quando alguém chama `forceFlush` (o flush por
 * requisição, já limitado a uma vez por minuto). Em delta (padrão), cada exportação leva só o que
 * mudou desde a anterior; em cumulativo, o total da instância desde que ela subiu.
 */
export class OnDemandMetricReader extends MetricReader {
  readonly #exporter: PushMetricExporter

  constructor(
    exporter: PushMetricExporter,
    temporality: MetricsTemporality = MetricsTemporality.Delta,
  ) {
    const selected =
      temporality === MetricsTemporality.Cumulative
        ? AggregationTemporality.CUMULATIVE
        : AggregationTemporality.DELTA
    super({ aggregationTemporalitySelector: () => selected })
    this.#exporter = exporter
  }

  protected override async onForceFlush(): Promise<void> {
    const { resourceMetrics } = await this.collect()
    if (resourceMetrics.scopeMetrics.every((scope) => scope.metrics.length === 0)) {
      return
    }
    await new Promise<void>((resolve) => {
      this.#exporter.export(resourceMetrics, () => {
        resolve()
      })
    })
  }

  protected override async onShutdown(): Promise<void> {
    // Encerramento: o que ficou desde a última exportação sai agora, sem esperar o intervalo.
    await this.onForceFlush()
    await this.#exporter.shutdown()
  }
}

function telemetryResource(identity: TelemetryIdentity): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: TRACER_NAME,
      [ATTR_SERVICE_VERSION]: identity.serviceVersion,
      'deployment.environment.name': identity.environment,
      'vcs.ref.head.revision': identity.gitSha,
      'process.runtime.name': 'nodejs',
      'process.runtime.version': process.versions.node,
      // Uma por processo: separa as séries de instâncias simultâneas (necessário em cumulativo).
      'service.instance.id': randomUUID(),
      ...(identity.region === null ? {} : { 'cloud.region': identity.region }),
    }),
  )
}

function otlpExporters(target: OtlpTarget): TelemetryExporters {
  const base = target.endpoint.replace(/\/+$/, '')
  const options = (signal: string) => ({
    url: `${base}/v1/${signal}`,
    headers: { ...target.headers },
    timeoutMillis: EXPORT_TIMEOUT_MS,
  })
  return {
    spans: new OTLPTraceExporter(options('traces')),
    logs: new OTLPLogExporter(options('logs')),
    metrics: new OTLPMetricExporter(options('metrics')),
  }
}

async function settle(work: readonly (Promise<unknown> | undefined)[]): Promise<void> {
  // Falha de exportação não vira erro da requisição nem log (que geraria outro log a exportar).
  await Promise.allSettled(work)
}

export function startTelemetry(options: TelemetryOptions): TelemetryRuntime {
  const resource = telemetryResource(options.identity)
  const exporters =
    options.exporters ?? (options.otlp === null ? null : otlpExporters(options.otlp))
  const spanProcessors: SpanProcessor[] = [
    ...(exporters === null ? [] : [new BatchSpanProcessor(exporters.spans)]),
    ...(options.spanProcessors ?? []),
  ]
  const tracerProvider = new NodeTracerProvider({
    resource,
    sampler: new TekoSampler(),
    spanProcessors,
  })
  if (options.registerGlobal ?? true) {
    tracerProvider.register()
  }
  const instrumentation = new FastifyOtel.FastifyOtelInstrumentation({
    registerOnInitialization: false,
  })
  instrumentation.setTracerProvider(tracerProvider)

  if (exporters === null) {
    return {
      exporting: spanProcessors.length > 0,
      telemetry: noopTelemetry,
      fastifyPlugin: instrumentation.plugin(),
      logSink: null,
      tracerProvider,
      flush: () => settle([tracerProvider.forceFlush()]),
      shutdown: () => settle([tracerProvider.shutdown()]),
    }
  }

  const reader = new OnDemandMetricReader(exporters.metrics, options.metricsTemporality)
  const meterProvider = new MeterProvider({ resource, readers: [reader] })
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: exporters.logs })],
  })
  const intervalMs = options.metricsIntervalMs ?? METRICS_EXPORT_INTERVAL_MS
  const nowMs = options.nowMs ?? Date.now
  let lastMetricsExportMs: number | null = null

  const metricsDue = (): boolean => {
    const now = nowMs()
    if (lastMetricsExportMs !== null && now - lastMetricsExportMs < intervalMs) {
      return false
    }
    lastMetricsExportMs = now
    return true
  }

  return {
    exporting: true,
    telemetry: createOtelTelemetry(meterProvider.getMeter(TRACER_NAME)),
    fastifyPlugin: instrumentation.plugin(),
    logSink: createOtelLogSink(loggerProvider.getLogger(TRACER_NAME)),
    tracerProvider,
    flush: () =>
      settle([
        tracerProvider.forceFlush(),
        loggerProvider.forceFlush(),
        metricsDue() ? meterProvider.forceFlush() : undefined,
      ]),
    shutdown: () =>
      settle([tracerProvider.shutdown(), loggerProvider.shutdown(), meterProvider.shutdown()]),
  }
}
