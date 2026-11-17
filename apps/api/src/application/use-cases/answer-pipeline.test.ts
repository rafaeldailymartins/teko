import type { TekoStreamChunk } from '@teko/shared/contracts'
import { describe, expect, it } from 'vitest'
import type { Evidence } from '#domain/qa/evidence.ts'
import { LlmError, type LlmEvent, type LlmModel, type LlmRequest } from '../ports/llm-port.ts'
import type { Telemetry } from '../ports/telemetry.ts'
import { recordingLlmTracing } from '../ports/testing/recording-llm-tracing.ts'
import { recordingTelemetry } from '../ports/testing/recording-telemetry.ts'
import { PROMPT_CANARY } from '../prompts/answer.ts'
import { createProviderRouter } from '../services/provider-router.ts'
import { createQueryTracer, type QueryTrace } from '../services/trace-sampler.ts'
import {
  type AnswerOutcome,
  retrievalSummary,
  runAnswerPipeline,
  toCitation,
  toResolved,
} from './answer-pipeline.ts'
import type { RetrieveEvidence } from './retrieve-evidence.ts'

const REFERENCE = {
  value: '2006-05-01',
  source: 'periodo_apuracao' as const,
  periodBoundaryInside: false,
  alternatives: [],
  periodo: '2006-05',
}

function evidence(stableKey: string, family = 'rcte'): Evidence {
  return {
    chunkId: stableKey,
    stableKey,
    family,
    citationLabel: `RCTE, ${stableKey}`,
    headingPath: 'RCTE > Art. 76',
    ancestors: [],
    content: 'texto da redação',
    validity: { from: '2005-01-01', to: null },
    document: {
      versionId: 'v',
      versionLabel: 'consolidado',
      title: 'RCTE',
      sourceUrl: 'https://appasp.economia.go.gov.br/legislacao/arquivos/Rcte/RCTE.htm',
    },
    rrf: 0.03,
    lexicalRank: 1,
    semanticRank: 1,
    referenceRank: null,
  }
}

const EVIDENCE = [evidence('go:rcte:art:76'), evidence('go:rcte:art:77')]

function retrieveWith(result: Awaited<ReturnType<RetrieveEvidence>>): RetrieveEvidence {
  return async () => result
}

const FOUND = retrieveWith({
  outcome: 'evidence',
  reference: REFERENCE,
  mode: 'hybrid',
  evidence: EVIDENCE,
  uncoveredFamilies: ['cte'],
  stableKeys: [],
  rewrittenQuery: null,
  reranked: true,
})

function scriptedModel(text: string): LlmModel & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = []
  return {
    provider: 'gemini',
    model: 'gemini-test',
    zeroDataRetention: false,
    requests,
    async *stream(request): AsyncIterable<LlmEvent> {
      requests.push(request)
      for (const piece of text.match(/.{1,7}/gs) ?? []) {
        yield { type: 'text', text: piece }
      }
      yield { type: 'finish', usage: { inputTokens: 100, outputTokens: 20 } }
    },
  }
}

async function run(
  retrieve: RetrieveEvidence,
  answer: string,
  telemetry?: Telemetry,
  options: { readonly trace?: QueryTrace; readonly models?: LlmModel[] } = {},
): Promise<{
  chunks: TekoStreamChunk[]
  outcome: AnswerOutcome | null
  model: ReturnType<typeof scriptedModel>
}> {
  const model = scriptedModel(answer)
  let outcome: AnswerOutcome | null = null
  const chunks: TekoStreamChunk[] = []
  let now = 1000
  for await (const chunk of runAnswerPipeline(
    {
      retrieveEvidence: retrieve,
      router: createProviderRouter({
        models: options.models ?? [model],
        clock: { now: () => new Date(now) },
      }),
      corpusVersion: async () => 14,
      ...(telemetry === undefined ? {} : { telemetry }),
      nowMs: () => {
        now += 10
        return now
      },
    },
    {
      messageId: 'q1',
      question: 'Qual o prazo?',
      referenceInput: { periodoApuracao: '2006-05' },
      referenceSource: 'periodo_apuracao',
      families: ['rcte', 'cte'],
      locale: 'pt-BR',
      zeroDataRetention: false,
      signal: new AbortController().signal,
      ...(options.trace === undefined ? {} : { trace: options.trace }),
    },
    (value) => {
      outcome = value
    },
  )) {
    chunks.push(chunk)
  }
  return { chunks, outcome, model }
}

describe('runAnswerPipeline', () => {
  it('responde com as citações usadas válidas e as demais reenviadas como inválidas', async () => {
    const { chunks, outcome, model } = await run(FOUND, 'Vale a regra [S1] <b>sim</b>.')
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'start',
      'data-reference-date',
      'data-meta',
      'data-citation',
      'data-citation',
      'text-start',
      ...chunks.filter((chunk) => chunk.type === 'text-delta').map(() => 'text-delta'),
      'text-end',
      'data-citation',
    ])
    expect(chunks.at(-1)).toMatchObject({ id: 'S2', data: { valid: false } })
    expect(chunks.find((chunk) => chunk.type === 'data-meta')).toMatchObject({
      data: {
        corpusVersion: 14,
        retrievalMode: 'hybrid',
        uncoveredFamilies: ['cte'],
        provider: 'gemini',
        fallbackFrom: null,
        cached: false,
      },
    })
    const text = chunks
      .filter((chunk) => chunk.type === 'text-delta')
      .map((chunk) => (chunk.type === 'text-delta' ? chunk.delta : ''))
      .join('')
    expect(text).toBe('Vale a regra [S1](cite:S1) sim.')
    expect(outcome).toMatchObject({
      refusal: null,
      model: 'gemini-test',
      provider: 'gemini',
      usage: { inputTokens: 100, outputTokens: 20 },
      answer: { markdown: 'Vale a regra [S1](cite:S1) sim.' },
    })
    expect(outcome?.firstTokenAtMs).toBeGreaterThan(0)
    expect(outcome?.answer?.citations.map((citation) => citation.valid)).toEqual([true, false])
    expect(model.requests[0]?.prompt).toContain('<source id="S2"')
  })

  it.each([
    ['INSUFICIENTE', 'model_insufficient'],
    ['Sem fonte nenhuma.', 'citation_invalid'],
    [`Regra: ${PROMPT_CANARY} [S1]`, 'model_insufficient'],
  ])('"%s" vira recusa %s', async (answer, reason) => {
    const { chunks, outcome } = await run(FOUND, answer)
    expect(chunks.at(-1)).toMatchObject({ type: 'data-refusal', data: { reason } })
    expect(outcome).toMatchObject({ answer: null, refusal: { reason } })
  })

  it('sem evidência, recusa sem chamar o LLM', async () => {
    const { chunks, outcome, model } = await run(
      retrieveWith({
        outcome: 'refused',
        reason: 'no_evidence',
        reference: REFERENCE,
        coverage: [],
        mode: 'lexical_only',
      }),
      '',
    )
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'start',
      'data-reference-date',
      'data-refusal',
    ])
    expect(outcome).toMatchObject({
      retrievalMode: 'lexical_only',
      refusal: { reason: 'no_evidence' },
    })
    expect(model.requests).toHaveLength(0)
  })

  it('pedido de esclarecimento no stream vira recusa no_evidence', async () => {
    const { chunks } = await run(
      retrieveWith({
        outcome: 'needs_clarification',
        reason: 'ambiguous_text',
        candidates: ['2024-03-01', '2024-05-01'],
      }),
      '',
    )
    expect(chunks.map((chunk) => chunk.type)).toEqual(['start', 'data-refusal'])
  })
})

describe('sinais de RAG', () => {
  it('conta o sentinel INSUFICIENTE com a corpus_version', async () => {
    const telemetry = recordingTelemetry()
    await run(FOUND, 'INSUFICIENTE', telemetry)
    expect(telemetry.calls).toEqual([{ method: 'insufficientSentinel', args: [14] }])
  })

  it('conta as citações a fontes inexistentes, removidas da resposta', async () => {
    const telemetry = recordingTelemetry()
    const { outcome } = await run(FOUND, 'Vale [S1], [S7] e [S9].', telemetry)
    expect(telemetry.calls).toEqual([{ method: 'citationsInvalidated', args: [2, 14] }])
    expect(outcome?.answer?.markdown).not.toContain('S9')
  })

  it('resposta com citações válidas não emite sinal de RAG', async () => {
    const telemetry = recordingTelemetry()
    await run(FOUND, 'Vale a regra [S1].', telemetry)
    expect(telemetry.calls).toEqual([])
  })
})

async function tracedRun(
  retrieve: RetrieveEvidence,
  answer: string,
  models?: LlmModel[],
): Promise<ReturnType<typeof recordingLlmTracing>['queries'][number]> {
  const port = recordingLlmTracing()
  const tracer = createQueryTracer({ port, sampler: { shouldSample: async () => true } })
  const trace = await tracer.start({
    questionId: 'q1',
    userId: 'u1',
    question: 'Qual o prazo?',
    locale: 'pt-BR',
    families: [],
    referenceDate: '2006-05-01',
    referenceSource: 'periodo_apuracao',
    corpusVersion: 14,
    promptVersion: 'answer@1',
    cached: false,
    startedAtMs: 0,
  })
  await run(retrieve, answer, undefined, { trace, ...(models === undefined ? {} : { models }) })
  return port.queries[0] as ReturnType<typeof recordingLlmTracing>['queries'][number]
}

function failingModel(model: string): LlmModel {
  return {
    provider: 'gemini',
    model,
    zeroDataRetention: false,
    // biome-ignore lint/correctness/useYield: falha antes do primeiro evento, como um 429
    async *stream(): AsyncIterable<LlmEvent> {
      throw new LlmError('rate_limited', '429')
    },
  }
}

describe('trace rag-query (Langfuse)', () => {
  it('span retrieval com o resumo da busca e uma generation com uso, custo e TTFT', async () => {
    const query = await tracedRun(FOUND, 'Vale a regra [S1].')
    expect(query.retrievals).toHaveLength(1)
    expect(query.retrievals[0]?.summary).toEqual({
      mode: 'hybrid',
      topK: 2,
      candidatesByChannel: { lexical: 2, semantic: 2, reference: 0 },
      rrf: [0.03, 0.03],
      reranked: true,
      rewritten: false,
      uncoveredFamilies: ['cte'],
      refusalReason: null,
    })
    expect(query.generations).toHaveLength(1)
    const [generation] = query.generations
    expect(generation?.start).toMatchObject({
      provider: 'gemini',
      model: 'gemini-test',
      temperature: 0.1,
    })
    expect(generation?.start.input).toContain('<source id="S1"')
    expect(generation?.end).toMatchObject({
      error: null,
      usage: { inputTokens: 100, outputTokens: 20 },
      cost: { input: 0, output: 0, total: 0 },
      // O texto que o usuário viu (já saneado), não o bruto do modelo.
      output: 'Vale a regra [S1](cite:S1).',
    })
    expect(generation?.end?.firstTokenAtMs).toBeGreaterThan(0)
  })

  it('uma generation por provedor tentado: a que falhou antes do token vem com o erro', async () => {
    const query = await tracedRun(FOUND, 'Vale a regra [S1].', [
      failingModel('gemini-3.5-flash-lite'),
      { ...scriptedModel('Vale a regra [S1].'), model: 'gemini-3.6-flash' },
    ])
    expect(query.generations.map((item) => [item.start.model, item.end?.error])).toEqual([
      ['gemini-3.5-flash-lite', 'rate_limited'],
      ['gemini-3.6-flash', null],
    ])
    expect(query.generations[0]?.end?.cost.total).toBe(0)
    expect(query.generations[1]?.end?.cost).toEqual({
      input: 0.00003,
      output: 0.00005,
      total: 0.00008,
    })
  })

  it('recusa na busca: só o span retrieval, sem generation', async () => {
    const query = await tracedRun(
      retrieveWith({
        outcome: 'refused',
        reason: 'no_evidence',
        reference: REFERENCE,
        coverage: [],
        mode: 'lexical_only',
      }),
      '',
    )
    expect(query.retrievals[0]?.summary).toMatchObject({
      mode: 'lexical_only',
      topK: 0,
      refusalReason: 'no_evidence',
    })
    expect(query.generations).toEqual([])
  })

  it('busca que falha fecha o span retrieval vazio e propaga o erro', async () => {
    const port = recordingLlmTracing()
    const trace = await createQueryTracer({
      port,
      sampler: { shouldSample: async () => true },
    }).start({
      questionId: 'q1',
      userId: 'u1',
      question: 'x',
      locale: 'pt-BR',
      families: [],
      referenceDate: '2006-05-01',
      referenceSource: 'explicit',
      corpusVersion: null,
      promptVersion: 'p',
      cached: false,
      startedAtMs: 0,
    })
    const failing: RetrieveEvidence = () => Promise.reject(new Error('banco fora'))
    await expect(run(failing, '', undefined, { trace })).rejects.toThrow('banco fora')
    expect(port.queries[0]?.retrievals[0]?.summary).toMatchObject({ mode: null, topK: 0 })
  })

  it('resumo de um pedido de esclarecimento: recusa no_evidence sem modo', () => {
    expect(
      retrievalSummary({
        outcome: 'needs_clarification',
        reason: 'ambiguous_text',
        candidates: [],
      }),
    ).toMatchObject({ mode: null, refusalReason: 'no_evidence' })
  })
})

describe('auxiliares', () => {
  it('toResolved descarta o período interno', () => {
    expect(toResolved(REFERENCE)).toEqual({
      value: '2006-05-01',
      source: 'periodo_apuracao',
      periodBoundaryInside: false,
      alternatives: [],
    })
  })

  it('toCitation usa a jurisdição da família e marca a redação vigente', () => {
    expect(
      toCitation(evidence('br:efd-icms-ipi:reg:C170', 'efd-icms-ipi'), 'S1', true),
    ).toMatchObject({
      jurisdiction: 'BR',
      isCurrent: true,
    })
    expect(toCitation(evidence('go:rcte:art:1'), 'S2', false)).toMatchObject({
      jurisdiction: 'GO',
      valid: false,
    })
    expect(toCitation(evidence('x:y', 'familia-desconhecida'), 'S3', true).jurisdiction).toBe('BR')
  })
})
