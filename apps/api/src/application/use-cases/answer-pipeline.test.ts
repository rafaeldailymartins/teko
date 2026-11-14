import type { TekoStreamChunk } from '@teko/shared/contracts'
import { describe, expect, it } from 'vitest'
import type { Evidence } from '#domain/qa/evidence.ts'
import type { LlmEvent, LlmModel, LlmRequest } from '../ports/llm-port.ts'
import { PROMPT_CANARY } from '../prompts/answer.ts'
import { createProviderRouter } from '../services/provider-router.ts'
import { type AnswerOutcome, runAnswerPipeline, toCitation, toResolved } from './answer-pipeline.ts'
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
      router: createProviderRouter({ models: [model], clock: { now: () => new Date(0) } }),
      corpusVersion: async () => 14,
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
