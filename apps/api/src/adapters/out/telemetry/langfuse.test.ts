import { context, propagation, trace } from '@opentelemetry/api'
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import type { Citation } from '@teko/shared/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import type { QueryTraceEnd, QueryTraceStart, RetrievalSummary } from '#app/ports/llm-tracing.ts'
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
  conversationId: '0199cccc-0000-7000-8000-000000000003',
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

const RETRIEVAL: RetrievalSummary = {
  query: START.question,
  rewrittenQuery: 'prazo de recolhimento do ICMS',
  referenceDate: '2026-11-01',
  families: ['rcte'],
  mode: 'hybrid',
  items: [
    {
      chunkId: 'c1',
      stableKey: 'go:rcte:art:76',
      label: 'RCTE, art. 76',
      headingPath: 'RCTE > Art. 76',
      family: 'rcte',
      documentVersion: 'consolidado',
      validity: { from: '2005-01-01', to: null },
      rrf: 0.0328,
      lexicalRank: 1,
      semanticRank: 2,
      referenceRank: null,
    },
    {
      chunkId: 'c2',
      stableKey: 'go:rcte:art:77',
      label: 'RCTE, art. 77',
      headingPath: 'RCTE > Art. 77',
      family: 'rcte',
      documentVersion: 'consolidado',
      validity: { from: '2005-01-01', to: null },
      rrf: 0.0161,
      lexicalRank: 3,
      semanticRank: null,
      referenceRank: null,
    },
  ],
  reranked: true,
  uncoveredFamilies: [],
  refusalReason: null,
}

const CITATION: Citation = {
  id: 'S1',
  stableKey: 'go:rcte:art:76',
  label: 'RCTE, art. 76',
  family: 'rcte',
  jurisdiction: 'GO',
  document: { title: 'RCTE', versionLabel: 'consolidado', sourceUrl: 'https://example.org/rcte' },
  validity: { from: '2005-01-01', to: null },
  isCurrent: true,
  excerpt: 'O imposto será recolhido…',
  valid: true,
}

const ANSWERED: QueryTraceEnd = {
  outcome: 'answered',
  refusalReason: null,
  answer: 'Vale [S1](cite:S1).',
  citations: [CITATION, { ...CITATION, id: 'S2', valid: false }],
  corpusVersion: 14,
  endedAtMs: START.startedAtMs + 1600,
}

const byName = (spans: readonly ReadableSpan[], name: string): ReadableSpan =>
  spans.find((span) => span.name === name) as ReadableSpan

const json = (span: ReadableSpan, key: string): unknown => JSON.parse(String(span.attributes[key]))

function runQuery(end: QueryTraceEnd = ANSWERED) {
  const tracing = createLangfuseTracing()
  const request = trace.getTracer('teko-api').startSpan('request', {
    attributes: { 'url.path': '/api/v1/questions/x/stream' },
  })
  const observations = context.with(trace.setSpan(context.active(), request), () =>
    tracing.startQuery(START),
  )
  const t0 = START.startedAtMs
  const answerCall = {
    purpose: 'answer',
    promptVersion: START.promptVersion,
    system: 'Você é o Tekó.',
    prompt: '<source id="S1">…</source>\n\nPergunta: Prazo do ICMS?',
    temperature: 0.1,
    maxOutputTokens: 1200,
  } as const
  observations.retrieval(t0 + 10).end(RETRIEVAL, t0 + 200)
  observations
    .generation({
      ...answerCall,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      startedAtMs: t0 + 210,
    })
    .end({
      error: 'rate_limited',
      usage: { inputTokens: 0, outputTokens: 0 },
      cost: { input: 0, output: 0, total: 0 },
      firstTokenAtMs: null,
      output: null,
      reasoning: null,
      endedAtMs: t0 + 260,
    })
  observations
    .generation({
      ...answerCall,
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      startedAtMs: t0 + 270,
    })
    .end({
      error: null,
      usage: { inputTokens: 1000, outputTokens: 100 },
      cost: { input: 0.00015, output: 0.00006, total: 0.00021 },
      firstTokenAtMs: t0 + 670,
      output: 'Vale [S1](cite:S1).',
      reasoning: 'A fonte S1 diz o prazo.',
      endedAtMs: t0 + 1500,
    })
  // Span do adapter de LLM (`gen_ai.*`): vai ao Grafana, não ao Langfuse.
  context.with(trace.setSpan(context.active(), request), () => {
    startClientSpan('chat openai/gpt-oss-120b', { 'gen_ai.operation.name': 'chat' }).end()
  })
  observations.end(end)
  request.end()
  return { observations, request }
}

async function exported(end?: QueryTraceEnd) {
  const { provider, langfuse } = setup()
  runQuery(end)
  await provider.forceFlush()
  return langfuse.getFinishedSpans()
}

describe('Langfuse (processor e observations)', () => {
  it('exporta só as observations do SDK, com o mesmo trace_id do OTel', async () => {
    const { provider, langfuse, grafana } = setup()
    const { observations, request } = runQuery()
    await provider.forceFlush()
    const spans = langfuse.getFinishedSpans()
    expect(spans.map((span) => span.name).toSorted(compareCodeUnits)).toEqual([
      'answer-question',
      'generate-answer',
      'generate-answer',
      'retrieve-context',
    ])
    const traceId = request.spanContext().traceId
    expect(observations.traceId).toBe(traceId)
    expect(new Set(spans.map((span) => span.spanContext().traceId))).toEqual(new Set([traceId]))
    // O Grafana recebe tudo, inclusive o `chat` e o `request`.
    expect(grafana.getFinishedSpans().map((span) => span.name)).toEqual(
      expect.arrayContaining(['request', 'chat openai/gpt-oss-120b', 'answer-question']),
    )
    // Filhas penduradas na raiz.
    const root = byName(spans, 'answer-question')
    for (const span of spans.filter((item) => item !== root)) {
      expect(span.parentSpanContext?.spanId).toBe(root.spanContext().spanId)
    }
  })

  it('raiz: a pergunta redigida na entrada, a resposta na saída e o contexto na metadata', async () => {
    const root = byName(await exported(), 'answer-question')
    const attributes = root.attributes
    expect(attributes['langfuse.environment']).toBe('ci')
    expect(attributes['langfuse.release']).toBe('abc1234')
    expect(attributes['langfuse.version']).toBe(START.promptVersion)
    expect(attributes['langfuse.observation.input']).toBe('Prazo do ICMS? CPF [CPF]')
    expect(attributes['langfuse.observation.output']).toBe('Vale [S1](cite:S1).')
    expect(attributes['langfuse.observation.level']).toBeUndefined()
    expect(json(root, 'langfuse.observation.metadata.families')).toEqual(['rcte'])
    expect(json(root, 'langfuse.observation.metadata.reference_date')).toBe('2026-11-01')
    expect(json(root, 'langfuse.observation.metadata.outcome')).toBe('answered')
    expect(json(root, 'langfuse.observation.metadata.citations')).toEqual([
      {
        id: 'S1',
        label: 'RCTE, art. 76',
        stableKey: 'go:rcte:art:76',
        document: 'RCTE — consolidado',
        validity: { from: '2005-01-01', to: null },
        excerpt: 'O imposto será recolhido…',
      },
    ])
    expect(json(root, 'langfuse.observation.metadata.uncited_sources')).toEqual(['S2'])
  })

  it('usuário com hash, conversa como sessão, tags e metadata do trace em toda observation', async () => {
    const spans = await exported()
    expect(spans).toHaveLength(4)
    for (const span of spans) {
      const attributes = span.attributes
      expect(attributes['langfuse.trace.name']).toBe('answer-question')
      expect(attributes['user.id']).toBe(langfuseUserId(START.userId))
      expect(attributes['user.id']).not.toContain(START.userId)
      expect(attributes['session.id']).toBe(START.conversationId)
      expect(attributes['langfuse.trace.tags']).toEqual(['llm', 'pt-BR'])
      expect(attributes['langfuse.trace.metadata.question_id']).toBe(START.questionId)
      expect(attributes['langfuse.trace.metadata.prompt_version']).toBeUndefined()
      expect(attributes['langfuse.trace.metadata.corpus_version']).toBe('14')
      expect(attributes['langfuse.trace.metadata.cached']).toBe('false')
    }
  })

  it('retriever: a consulta, a reescrita, a data e as famílias; na saída, os itens sem texto', async () => {
    const retriever = byName(await exported(), 'retrieve-context')
    expect(retriever.attributes['langfuse.observation.type']).toBe('retriever')
    expect(json(retriever, 'langfuse.observation.input')).toEqual({
      query: 'Prazo do ICMS? CPF [CPF]',
      rewrittenQuery: 'prazo de recolhimento do ICMS',
      referenceDate: '2026-11-01',
      families: ['rcte'],
    })
    expect(json(retriever, 'langfuse.observation.output')).toEqual(RETRIEVAL.items)
    expect(json(retriever, 'langfuse.observation.metadata.candidates_by_channel')).toEqual({
      lexical: 2,
      semantic: 1,
      reference: 0,
    })
    expect(json(retriever, 'langfuse.observation.metadata.top_k')).toBe(2)
    expect(json(retriever, 'langfuse.observation.metadata.rewritten')).toBe(true)
    expect(retriever.attributes['langfuse.observation.status_message']).toBeUndefined()
  })

  it('generation: mensagens OpenAI, raciocínio, modelo, uso, custo, faturado 0, TTFT e erro', async () => {
    const generations = (await exported()).filter((span) => span.name === 'generate-answer')
    const failed = generations.find(
      (span) => span.attributes['langfuse.observation.level'] === 'ERROR',
    )
    const answered = generations.find((span) => span !== failed) as ReadableSpan
    expect(failed?.attributes['langfuse.observation.status_message']).toBe('rate_limited')
    expect(failed?.attributes['langfuse.observation.output']).toBeUndefined()
    const attributes = answered.attributes
    expect(attributes['langfuse.observation.type']).toBe('generation')
    expect(attributes['langfuse.observation.model.name']).toBe('openai/gpt-oss-120b')
    expect(attributes['langfuse.version']).toBe(START.promptVersion)
    expect(json(answered, 'langfuse.observation.input')).toEqual([
      { role: 'system', content: 'Você é o Tekó.' },
      { role: 'user', content: '<source id="S1">…</source>\n\nPergunta: Prazo do ICMS?' },
    ])
    expect(json(answered, 'langfuse.observation.output')).toEqual({
      output: [
        {
          type: 'reasoning',
          content: [{ type: 'reasoning_text', text: 'A fonte S1 diz o prazo.' }],
        },
        { role: 'assistant', content: 'Vale [S1](cite:S1).' },
      ],
    })
    expect(json(answered, 'langfuse.observation.usage_details')).toEqual({
      input: 1000,
      output: 100,
      total: 1100,
    })
    expect(json(answered, 'langfuse.observation.cost_details')).toEqual({
      input: 0.00015,
      output: 0.00006,
      total: 0.00021,
    })
    expect(json(answered, 'langfuse.observation.metadata.provider')).toBe('groq')
    expect(json(answered, 'langfuse.observation.metadata.billed_usd')).toBe(0)
    expect(json(answered, 'langfuse.observation.metadata.ttft_ms')).toBe(400)
    expect(String(attributes['langfuse.observation.completion_start_time'])).toContain(
      '2026-11-17T12:00:00.670Z',
    )
  })

  it.each([
    ['refused', 'no_evidence', undefined, undefined, 'no_evidence'],
    ['failed', null, 'upstream_unavailable', 'ERROR', 'upstream_unavailable'],
    ['failed', null, undefined, 'ERROR', 'failed'],
    ['aborted', null, undefined, 'WARNING', 'aborted'],
  ] as const)(
    'desfecho %s (%s, %s): sem saída, nível e motivo',
    async (outcome, reason, failure, level, message) => {
      const root = byName(
        await exported({
          ...ANSWERED,
          outcome,
          refusalReason: reason,
          ...(failure === undefined ? {} : { failure }),
          answer: null,
          citations: [],
        }),
        'answer-question',
      )
      expect(root.attributes['langfuse.observation.output']).toBeUndefined()
      expect(root.attributes['langfuse.observation.level']).toBe(level)
      expect(root.attributes['langfuse.observation.status_message']).toBe(message)
      expect(json(root, 'langfuse.observation.metadata.citations')).toEqual([])
    },
  )

  it('generation sem raciocínio: só a mensagem do assistente; retriever recusado leva o motivo', async () => {
    const { provider, langfuse } = setup()
    const observations = createLangfuseTracing().startQuery({ ...START, cached: true })
    observations
      .retrieval(1)
      .end({ ...RETRIEVAL, items: [], mode: 'lexical_only', refusalReason: 'no_evidence' }, 2)
    observations
      .generation({
        purpose: 'rewrite',
        promptVersion: 'rewrite@1',
        system: 's',
        prompt: '<pergunta>x</pergunta>',
        temperature: 0,
        maxOutputTokens: 256,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        startedAtMs: 1,
      })
      .end({
        error: null,
        usage: { inputTokens: 10, outputTokens: 5 },
        cost: { input: 0, output: 0, total: 0 },
        firstTokenAtMs: null,
        output: 'prazo',
        reasoning: null,
        endedAtMs: 2,
      })
    observations.end({ ...ANSWERED, endedAtMs: 3 })
    await provider.forceFlush()
    const spans = langfuse.getFinishedSpans()
    const rewrite = byName(spans, 'rewrite-query')
    expect(json(rewrite, 'langfuse.observation.output')).toEqual({
      role: 'assistant',
      content: 'prazo',
    })
    expect(rewrite.attributes['langfuse.observation.metadata.ttft_ms']).toBeUndefined()
    expect(rewrite.attributes['langfuse.version']).toBe('rewrite@1')
    const retriever = byName(spans, 'retrieve-context')
    expect(retriever.attributes['langfuse.observation.status_message']).toBe('no_evidence')
    expect(byName(spans, 'answer-question').attributes['langfuse.trace.tags']).toEqual([
      'cache',
      'pt-BR',
    ])
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
