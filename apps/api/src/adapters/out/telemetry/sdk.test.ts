import { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs'
import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import {
  InMemorySpanExporter,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { describe, expect, it, vi } from 'vitest'
import { noopTelemetry } from '#app/ports/telemetry.ts'
import { METRICS_EXPORT_INTERVAL_MS, startTelemetry, type TelemetryOptions } from './sdk.ts'

const IDENTITY = {
  serviceVersion: '0.1.0',
  gitSha: 'abc1234',
  environment: 'staging',
  region: 'gru1',
} as const

const ANSWERED = {
  outcome: 'answered',
  refusalReason: null,
  retrievalMode: 'hybrid',
  cached: false,
  corpusVersion: 14,
} as const

function setup(overrides: Partial<TelemetryOptions> = {}) {
  const spans = new InMemorySpanExporter()
  const logs = new InMemoryLogRecordExporter()
  const metrics = new InMemoryMetricExporter(AggregationTemporality.DELTA)
  let now = 1_000_000
  const runtime = startTelemetry({
    identity: IDENTITY,
    otlp: null,
    exporters: { spans, logs, metrics },
    registerGlobal: false,
    nowMs: () => now,
    ...overrides,
  })
  return {
    runtime,
    spans,
    logs,
    metrics,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** Soma dos pontos de um counter numa exportação. */
function counterTotal(exported: ResourceMetrics | undefined, name: string): number {
  const metric = exported?.scopeMetrics
    .flatMap((scope) => scope.metrics)
    .find((item) => item.descriptor.name === name)
  if (metric?.dataPointType !== DataPointType.SUM) {
    return 0
  }
  return metric.dataPoints.reduce((total, point) => total + point.value, 0)
}

describe('startTelemetry', () => {
  it('resource com serviço, versão, ambiente, commit, runtime e região', () => {
    const { runtime, spans } = setup()
    runtime.tracerProvider.getTracer('t').startSpan('x').end()
    return runtime.flush().then(() => {
      const attributes = spans.getFinishedSpans()[0]?.resource.attributes
      expect(attributes).toMatchObject({
        'service.name': 'teko-api',
        'service.version': '0.1.0',
        'deployment.environment.name': 'staging',
        'vcs.ref.head.revision': 'abc1234',
        'process.runtime.name': 'nodejs',
        'process.runtime.version': process.versions.node,
        'cloud.region': 'gru1',
      })
    })
  })

  it('sem região (fora da Vercel), sem cloud.region', async () => {
    const { runtime, spans } = setup({ identity: { ...IDENTITY, region: null } })
    runtime.tracerProvider.getTracer('t').startSpan('x').end()
    await runtime.flush()
    expect(spans.getFinishedSpans()[0]?.resource.attributes).not.toHaveProperty('cloud.region')
  })

  it('o flush exporta traces e logs pendentes sem depender de timer', async () => {
    const { runtime, spans, logs } = setup()
    runtime.tracerProvider.getTracer('t').startSpan('request').end()
    runtime.logSink?.write(JSON.stringify({ level: 30, msg: 'oi', env: 'staging' }))
    expect(spans.getFinishedSpans()).toHaveLength(0)
    expect(logs.getFinishedLogRecords()).toHaveLength(0)
    await runtime.flush()
    expect(spans.getFinishedSpans().map((span) => span.name)).toEqual(['request'])
    expect(logs.getFinishedLogRecords().map((record) => record.body)).toEqual(['oi'])
  })

  it('métricas em delta, exportadas no máximo uma vez por minuto', async () => {
    const { runtime, metrics, advance } = setup()
    runtime.telemetry.answer(ANSWERED)
    await runtime.flush()
    expect(metrics.getMetrics()).toHaveLength(1)

    runtime.telemetry.answer(ANSWERED)
    advance(METRICS_EXPORT_INTERVAL_MS - 1)
    await runtime.flush()
    expect(metrics.getMetrics()).toHaveLength(1)

    advance(1)
    await runtime.flush()
    const exported = metrics.getMetrics()
    expect(exported).toHaveLength(2)
    // Delta: a segunda exportação leva só o que mudou desde a primeira.
    expect(counterTotal(exported[0], 'teko.rag.answers')).toBe(1)
    expect(counterTotal(exported[1], 'teko.rag.answers')).toBe(1)
  })

  it('em cumulativo, cada exportação leva o total da instância', async () => {
    const { runtime, metrics, advance } = setup({ metricsTemporality: 'cumulative' })
    runtime.telemetry.answer(ANSWERED)
    await runtime.flush()
    runtime.telemetry.answer(ANSWERED)
    advance(METRICS_EXPORT_INTERVAL_MS)
    await runtime.flush()
    const exported = metrics.getMetrics()
    expect(counterTotal(exported[0], 'teko.rag.answers')).toBe(1)
    expect(counterTotal(exported[1], 'teko.rag.answers')).toBe(2)
    expect(exported[1]?.resource.attributes['service.instance.id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('o intervalo das métricas é configurável e uma coleta vazia não exporta', async () => {
    const { runtime, metrics, advance } = setup({ metricsIntervalMs: 10 })
    await runtime.flush()
    expect(metrics.getMetrics()).toHaveLength(0)
    runtime.telemetry.answer(ANSWERED)
    advance(10)
    await runtime.flush()
    expect(metrics.getMetrics()).toHaveLength(1)
  })

  it('o encerramento exporta as métricas pendentes, sem esperar o intervalo', async () => {
    const { runtime, metrics } = setup()
    await runtime.flush()
    runtime.telemetry.answer(ANSWERED)
    await runtime.shutdown()
    expect(counterTotal(metrics.getMetrics().at(-1), 'teko.rag.answers')).toBe(1)
  })

  it('processors extras (o Langfuse) recebem os mesmos spans e entram no flush', async () => {
    const ended: ReadableSpan[] = []
    const extra: SpanProcessor = {
      onStart: () => {},
      onEnd: (span) => {
        ended.push(span)
      },
      forceFlush: vi.fn(async () => {}),
      shutdown: async () => {},
    }
    const { runtime, spans } = setup({ spanProcessors: [extra] })
    runtime.tracerProvider.getTracer('t').startSpan('chat').end()
    await runtime.flush()
    expect(ended[0]?.spanContext().traceId).toBe(spans.getFinishedSpans()[0]?.spanContext().traceId)
    expect(extra.forceFlush).toHaveBeenCalled()
  })

  it('falha de exportação não rejeita o flush', async () => {
    const { runtime, spans } = setup()
    vi.spyOn(spans, 'export').mockImplementation((_spans, done) => {
      done({ code: 1, error: new Error('fora do ar') })
    })
    runtime.tracerProvider.getTracer('t').startSpan('x').end()
    await expect(runtime.flush()).resolves.toBeUndefined()
  })

  it('sem endpoint nem exporters: nada sai, mas o provider existe para o trace_id', async () => {
    const runtime = startTelemetry({ identity: IDENTITY, otlp: null, registerGlobal: false })
    expect(runtime.exporting).toBe(false)
    expect(runtime.telemetry).toBe(noopTelemetry)
    expect(runtime.logSink).toBeNull()
    const span = runtime.tracerProvider.getTracer('t').startSpan('x')
    expect(span.isRecording()).toBe(true)
    span.end()
    await expect(runtime.flush()).resolves.toBeUndefined()
    await expect(runtime.shutdown()).resolves.toBeUndefined()
  })

  it('sem endpoint, um processor extra ainda exporta', () => {
    const extra: SpanProcessor = {
      onStart: () => {},
      onEnd: () => {},
      forceFlush: async () => {},
      shutdown: async () => {},
    }
    const runtime = startTelemetry({
      identity: IDENTITY,
      otlp: null,
      registerGlobal: false,
      spanProcessors: [extra],
    })
    expect(runtime.exporting).toBe(true)
  })

  it('com endpoint OTLP, liga traces, métricas e logs', () => {
    const runtime = startTelemetry({
      identity: IDENTITY,
      otlp: { endpoint: 'http://127.0.0.1:9/otlp/', headers: { Authorization: 'Basic eA==' } },
      registerGlobal: false,
    })
    expect(runtime.exporting).toBe(true)
    expect(runtime.telemetry).not.toBe(noopTelemetry)
    expect(runtime.logSink).not.toBeNull()
  })
})
