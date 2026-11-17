import { context, propagation, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import { afterEach, describe, expect, it } from 'vitest'
import type { QueryTraceStart } from '#app/ports/llm-tracing.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import { createLangfuseSpanProcessor, createLangfuseTracing, maskPii } from './langfuse.ts'
import { langfuseUserId } from './langfuse-user.ts'
import { TekoSampler } from './sampler.ts'
import { startClientSpan } from './tracing.ts'

afterEach(() => {
  trace.disable()
  context.disable()
  propagation.disable()
})

/** Provider global com o processor do Langfuse (exporter em memória) e um "Grafana" em memória. */
function setup() {
  const langfuse = new InMemorySpanExporter()
  const grafana = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({
    sampler: new TekoSampler(),
    spanProcessors: [
      new SimpleSpanProcessor(grafana),
      createLangfuseSpanProcessor({
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        baseUrl: 'http://127.0.0.1:9',
        environment: 'ci',
        release: 'abc1234',
        exporter: langfuse,
      }),
    ],
  })
  provider.register()
  return { provider, langfuse, grafana }
}

const START: QueryTraceStart = {
  questionId: '0199aaaa-0000-7000-8000-000000000001',
  userId: '0199bbbb-0000-7000-8000-000000000002',
  // Redigida no AskQuestion; o CPF aqui prova a segunda barreira (o `mask`).
  question: 'Prazo do ICMS? CPF 529.982.247-25',
  locale: 'pt-BR',
  families: ['rcte'],
  referenceDate: '2026-11-01',
  referenceSource: 'explicit',
  corpusVersion: 14,
  promptVersion: 'answer@1.0.0+abcd1234',
  cached: false,
  startedAtMs: Date.parse('2026-11-17T12:00:00Z'),
}

const byName = (spans: readonly ReadableSpan[], name: string): ReadableSpan =>
  spans.find((span) => span.name === name) as ReadableSpan

function runQuery() {
  const tracing = createLangfuseTracing()
  const request = trace.getTracer('teko-api').startSpan('request', {
    attributes: { 'url.path': '/api/v1/questions/x/stream' },
  })
  const observations = context.with(trace.setSpan(context.active(), request), () =>
    tracing.startQuery(START),
  )
  const t0 = START.startedAtMs
  observations.retrieval(t0 + 10).end(
    {
      mode: 'hybrid',
      topK: 2,
      candidatesByChannel: { lexical: 2, semantic: 1, reference: 0 },
      rrf: [0.0328, 0.0161],
      reranked: true,
      rewritten: false,
      uncoveredFamilies: [],
      refusalReason: null,
    },
    t0 + 200,
  )
  observations
    .generation({
      name: 'answer',
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      input: 'prompt',
      temperature: 0.1,
      maxOutputTokens: 1200,
      startedAtMs: t0 + 210,
    })
    .end({
      error: 'rate_limited',
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      firstTokenAtMs: null,
      output: null,
      endedAtMs: t0 + 260,
    })
  observations
    .generation({
      name: 'answer',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      input: 'prompt',
      temperature: 0.1,
      maxOutputTokens: 1200,
      startedAtMs: t0 + 270,
    })
    .end({
      error: null,
      usage: { inputTokens: 1000, outputTokens: 100 },
      cost: { input: 0.00015, output: 0.00006, total: 0.00021 },
      firstTokenAtMs: t0 + 670,
      output: 'Vale [S1](cite:S1).',
      endedAtMs: t0 + 1500,
    })
  // Span do adapter de LLM (`gen_ai.*`): vai ao Grafana, não ao Langfuse.
  context.with(trace.setSpan(context.active(), request), () => {
    startClientSpan('chat openai/gpt-oss-120b', { 'gen_ai.operation.name': 'chat' }).end()
  })
  observations.end({
    outcome: 'answered',
    refusalReason: null,
    answer: 'Vale [S1](cite:S1).',
    citations: 1,
    corpusVersion: 14,
    endedAtMs: t0 + 1600,
  })
  request.end()
  return { observations, request }
}

describe('Langfuse (processor e observations)', () => {
  it('exporta só as observations do SDK, com o mesmo trace_id do OTel', async () => {
    const { provider, langfuse, grafana } = setup()
    const { observations, request } = runQuery()
    await provider.forceFlush()
    const spans = langfuse.getFinishedSpans()
    expect(spans.map((span) => span.name).toSorted(compareCodeUnits)).toEqual([
      'answer',
      'answer',
      'rag-query',
      'retrieval',
    ])
    const traceId = request.spanContext().traceId
    expect(observations.traceId).toBe(traceId)
    expect(new Set(spans.map((span) => span.spanContext().traceId))).toEqual(new Set([traceId]))
    // O Grafana recebe tudo, inclusive o `chat` e o `request`.
    expect(grafana.getFinishedSpans().map((span) => span.name)).toEqual(
      expect.arrayContaining(['request', 'chat openai/gpt-oss-120b', 'rag-query']),
    )
    // Filhas penduradas na raiz.
    const root = byName(spans, 'rag-query')
    for (const span of spans.filter((item) => item !== root)) {
      expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })

  it('raiz rag-query: usuário com hash, pergunta redigida, ambiente, release e metadata', async () => {
    const { provider, langfuse } = setup()
    runQuery()
    await provider.forceFlush()
    const root = byName(langfuse.getFinishedSpans(), 'rag-query')
    const attributes = root.attributes
    expect(attributes['langfuse.trace.name']).toBe('rag-query')
    expect(attributes['user.id']).toBe(langfuseUserId(START.userId))
    expect(attributes['user.id']).not.toContain(START.userId)
    expect(attributes['langfuse.environment']).toBe('ci')
    expect(attributes['langfuse.release']).toBe('abc1234')
    expect(attributes['langfuse.trace.metadata.prompt_version']).toBe(
      JSON.stringify(START.promptVersion),
    )
    expect(attributes['langfuse.trace.metadata.corpus_version']).toBe('14')
    const input = String(attributes['langfuse.observation.input'])
    expect(input).toContain('[CPF]')
    expect(input).not.toContain('529.982.247-25')
    expect(JSON.parse(String(attributes['langfuse.observation.output']))).toMatchObject({
      outcome: 'answered',
      citations: 1,
    })
  })

  it('generation: modelo, uso, custo de tabela, faturado 0, TTFT e o erro do provedor', async () => {
    const { provider, langfuse } = setup()
    runQuery()
    await provider.forceFlush()
    const generations = langfuse.getFinishedSpans().filter((span) => span.name === 'answer')
    const failed = generations.find((span) => span.attributes['langfuse.observation.level'])
    const answered = generations.find((span) => span !== failed) as ReadableSpan
    expect(failed?.attributes['langfuse.observation.level']).toBe('ERROR')
    expect(failed?.attributes['langfuse.observation.status_message']).toBe('rate_limited')
    const attributes = answered.attributes
    expect(attributes['langfuse.observation.type']).toBe('generation')
    expect(attributes['langfuse.observation.model.name']).toBe('openai/gpt-oss-120b')
    expect(JSON.parse(String(attributes['langfuse.observation.usage_details']))).toEqual({
      input: 1000,
      output: 100,
      total: 1100,
    })
    expect(JSON.parse(String(attributes['langfuse.observation.cost_details']))).toEqual({
      input: 0.00015,
      output: 0.00006,
      total: 0.00021,
    })
    expect(attributes['langfuse.observation.metadata.billed_usd']).toBe('0')
    expect(attributes['langfuse.observation.metadata.ttft_ms']).toBe('400')
    expect(String(attributes['langfuse.observation.completion_start_time'])).toContain(
      '2026-11-17T12:00:00.670Z',
    )
  })

  it('maskPii redige strings em qualquer profundidade e preserva o resto', () => {
    expect(
      maskPii({ a: ['fale com ana@example.com', 3], b: { c: '529.982.247-25' }, d: null }),
    ).toEqual({ a: ['fale com [EMAIL]', 3], b: { c: '[CPF]' }, d: null })
  })

  it('o hash do usuário é estável e não revela o id', () => {
    expect(langfuseUserId('u1')).toBe(langfuseUserId('u1'))
    expect(langfuseUserId('u1')).not.toBe(langfuseUserId('u2'))
    expect(langfuseUserId('u1')).toMatch(/^[0-9a-f]{32}$/)
  })
})
