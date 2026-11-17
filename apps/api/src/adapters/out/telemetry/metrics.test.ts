import {
  AggregationTemporality,
  DataPointType,
  InMemoryMetricExporter,
  MeterProvider,
  type MetricData,
} from '@opentelemetry/sdk-metrics'
import { describe, expect, it } from 'vitest'
import { LlmError, LlmErrorKind, type LlmEvent, type LlmModel } from '#app/ports/llm-port.ts'
import { createProviderRouter } from '#app/services/provider-router.ts'
import { createOtelTelemetry, MetricName } from './metrics.ts'
import { OnDemandMetricReader } from './sdk.ts'

function setup() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA)
  const reader = new OnDemandMetricReader(exporter)
  const provider = new MeterProvider({ readers: [reader] })
  const telemetry = createOtelTelemetry(provider.getMeter('teste'))
  const collect = async (): Promise<Map<string, MetricData>> => {
    await reader.forceFlush()
    const metrics = exporter
      .getMetrics()
      .flatMap((resource) => resource.scopeMetrics.flatMap((scope) => scope.metrics))
    exporter.reset()
    return new Map(metrics.map((metric) => [metric.descriptor.name, metric]))
  }
  return { telemetry, collect }
}

type Point = { attributes: Record<string, unknown>; value: unknown }

function points(metric: MetricData | undefined): Point[] {
  return (metric?.dataPoints ?? []).map((point) => ({
    attributes: { ...point.attributes },
    value: point.value,
  }))
}

describe('createOtelTelemetry', () => {
  it('duração HTTP em segundos, com método, rota e status (sem rota no 404)', async () => {
    const { telemetry, collect } = setup()
    telemetry.httpRequest({
      method: 'POST',
      route: '/api/v1/questions',
      statusCode: 200,
      durationSeconds: 0.2,
    })
    telemetry.httpRequest({ method: 'GET', route: null, statusCode: 404, durationSeconds: 0.01 })
    const metric = (await collect()).get('http.server.request.duration')
    expect(metric?.descriptor.unit).toBe('s')
    expect(metric?.dataPointType).toBe(DataPointType.HISTOGRAM)
    expect(points(metric).map((point) => point.attributes)).toEqual([
      {
        'http.request.method': 'POST',
        'http.response.status_code': 200,
        'http.route': '/api/v1/questions',
      },
      { 'http.request.method': 'GET', 'http.response.status_code': 404 },
    ])
  })

  it('teko.rag.answers com desfecho, motivo, modo, cache e corpus_version', async () => {
    const { telemetry, collect } = setup()
    telemetry.answer({
      outcome: 'refused',
      refusalReason: 'no_evidence',
      retrievalMode: 'lexical_only',
      cached: false,
      corpusVersion: 14,
    })
    telemetry.answer({
      outcome: 'failed',
      refusalReason: null,
      retrievalMode: null,
      cached: false,
      corpusVersion: null,
    })
    expect(points((await collect()).get(MetricName.RagAnswers))).toEqual([
      {
        attributes: {
          outcome: 'refused',
          cached: false,
          refusal_reason: 'no_evidence',
          retrieval_mode: 'lexical_only',
          corpus_version: 14,
        },
        value: 1,
      },
      { attributes: { outcome: 'failed', cached: false }, value: 1 },
    ])
  })

  it('citações invalidadas e sentinel', async () => {
    const { telemetry, collect } = setup()
    telemetry.citationsInvalidated(3, 14)
    telemetry.insufficientSentinel(null)
    const metrics = await collect()
    expect(points(metrics.get(MetricName.RagCitationsInvalidated))).toEqual([
      { attributes: { corpus_version: 14 }, value: 3 },
    ])
    expect(points(metrics.get(MetricName.RagInsufficientSentinel))).toEqual([
      { attributes: {}, value: 1 },
    ])
  })

  it('nota do reranker no top-1 e em todo o top-12; lista vazia não grava', async () => {
    const { telemetry, collect } = setup()
    telemetry.rerankerScores([])
    telemetry.rerankerScores([0.9, 0.5, 0.2])
    const metric = (await collect()).get(MetricName.RagRerankerScore)
    const counts = points(metric).map((point) => ({
      rank: point.attributes['rank'],
      count: (point.value as { count: number }).count,
      max: (point.value as { max: number }).max,
    }))
    expect(counts).toEqual([
      { rank: 'top1', count: 1, max: 0.9 },
      { rank: 'top12', count: 3, max: 0.9 },
    ])
  })

  it('chamada de LLM: TTFT, tokens por tipo e custo-sombra; sem TTFT sem histograma', async () => {
    const { telemetry, collect } = setup()
    telemetry.llmCall({
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      ttftSeconds: 0.8,
      inputTokens: 1000,
      outputTokens: 200,
      shadowCostUsd: 0.0004,
    })
    telemetry.llmCall({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      ttftSeconds: null,
      inputTokens: 10,
      outputTokens: 0,
      shadowCostUsd: 0,
    })
    const metrics = await collect()
    const gemini = { provider: 'gemini', model: 'gemini-3.5-flash-lite' }
    const groq = { provider: 'groq', model: 'openai/gpt-oss-120b' }
    expect(metrics.get(MetricName.LlmTtft)?.descriptor.unit).toBe('s')
    expect(points(metrics.get(MetricName.LlmTtft)).map((point) => point.attributes)).toEqual([
      gemini,
    ])
    expect(points(metrics.get(MetricName.LlmTokens))).toEqual([
      { attributes: { ...gemini, type: 'input' }, value: 1000 },
      { attributes: { ...gemini, type: 'output' }, value: 200 },
      { attributes: { ...groq, type: 'input' }, value: 10 },
      { attributes: { ...groq, type: 'output' }, value: 0 },
    ])
    expect(metrics.get(MetricName.LlmShadowCost)?.descriptor.unit).toBe('USD')
    expect(points(metrics.get(MetricName.LlmShadowCost))).toEqual([
      { attributes: gemini, value: 0.0004 },
      { attributes: groq, value: 0 },
    ])
  })

  it('erros, fallback e cota', async () => {
    const { telemetry, collect } = setup()
    telemetry.providerError('gemini', '429')
    telemetry.providerFallback('gemini-3.5-flash-lite', 'gemini-3.6-flash')
    telemetry.quotaUsage([
      { scope: 'global_questions', ratio: 0.5 },
      { scope: 'global_neurons', ratio: 0.75 },
    ])
    const metrics = await collect()
    expect(points(metrics.get(MetricName.LlmProviderErrors))).toEqual([
      { attributes: { provider: 'gemini', status: '429' }, value: 1 },
    ])
    expect(points(metrics.get(MetricName.LlmProviderFallback))).toEqual([
      { attributes: { from: 'gemini-3.5-flash-lite', to: 'gemini-3.6-flash' }, value: 1 },
    ])
    expect(metrics.get(MetricName.QuotaUsedRatio)?.dataPointType).toBe(DataPointType.GAUGE)
    expect(points(metrics.get(MetricName.QuotaUsedRatio))).toEqual([
      { attributes: { scope: 'global_questions' }, value: 0.5 },
      { attributes: { scope: 'global_neurons' }, value: 0.75 },
    ])
  })

  it('emitidas pela cadeia de LLM de verdade, com o exporter em memória', async () => {
    const { telemetry, collect } = setup()
    const failing: LlmModel = {
      provider: 'gemini',
      model: 'gemini-a',
      zeroDataRetention: false,
      // biome-ignore lint/correctness/useYield: falha antes do primeiro evento
      async *stream(): AsyncIterable<LlmEvent> {
        throw new LlmError(LlmErrorKind.RateLimited, '429')
      },
    }
    const working: LlmModel = {
      provider: 'groq',
      model: 'groq-b',
      zeroDataRetention: true,
      async *stream(): AsyncIterable<LlmEvent> {
        yield { type: 'text', text: 'ok' }
      },
    }
    const router = createProviderRouter({
      models: [failing, working],
      clock: { now: () => new Date('2026-11-10T15:00:00Z') },
      telemetry,
    })
    const request = {
      system: 's',
      prompt: 'p',
      temperature: 0.1,
      maxOutputTokens: 10,
      signal: new AbortController().signal,
    }
    for await (const _event of router.stream(request, { zeroDataRetentionOnly: false })) {
      // consome o stream
    }
    const metrics = await collect()
    expect(points(metrics.get(MetricName.LlmProviderErrors))).toEqual([
      { attributes: { provider: 'gemini', status: '429' }, value: 1 },
    ])
    expect(points(metrics.get(MetricName.LlmProviderFallback))).toEqual([
      { attributes: { from: 'gemini-a', to: 'groq-b' }, value: 1 },
    ])
  })
})
