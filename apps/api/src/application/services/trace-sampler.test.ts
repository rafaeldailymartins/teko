import { describe, expect, it, vi } from 'vitest'
import type { LlmTracingPort } from '../ports/llm-tracing.ts'
import { recordingLlmTracing } from '../ports/testing/recording-llm-tracing.ts'
import {
  createQueryTracer,
  createTraceSampler,
  disabledQueryTracer,
  isSampled,
  monthProgress,
  projectMonthlyUnits,
  type SamplingPolicy,
  samplingBucket,
  samplingRate,
  UNITS_CACHE_TTL_MS,
  untracedQuery,
} from './trace-sampler.ts'

const PRODUCTION: SamplingPolicy = { rate: 1, overBudgetRate: 0.2, monthlyUnitsCutoff: 35_000 }
const STAGING: SamplingPolicy = { rate: 0.1, overBudgetRate: 0.2, monthlyUnitsCutoff: 35_000 }
const CI: SamplingPolicy = { rate: 0, overBudgetRate: 0.2, monthlyUnitsCutoff: 35_000 }

/** Meio-dia de 15/11/2026 em São Paulo (UTC−3): 14,5 dias decorridos de 30. */
const MID_NOVEMBER = new Date('2026-11-15T15:00:00Z')

const ids = Array.from({ length: 4000 }, (_, index) => `0199${String(index).padStart(8, '0')}-q`)

const START = {
  questionId: 'q1',
  userId: 'u1',
  question: 'Qual o prazo?',
  locale: 'pt-BR',
  families: [],
  referenceDate: '2026-11-01',
  referenceSource: 'explicit',
  corpusVersion: 3,
  promptVersion: 'answer@1',
  cached: false,
  startedAtMs: 0,
} as const

describe('samplingBucket', () => {
  it('é determinístico pelo id e fica em [0, 1)', () => {
    expect(samplingBucket('0199a-q')).toBe(samplingBucket('0199a-q'))
    for (const id of ids.slice(0, 200)) {
      const bucket = samplingBucket(id)
      expect(bucket).toBeGreaterThanOrEqual(0)
      expect(bucket).toBeLessThan(1)
    }
  })

  it('espalha os ids: a fração amostrada fica perto da taxa', () => {
    const sampled = ids.filter((id) => isSampled(id, 0.2)).length / ids.length
    expect(sampled).toBeGreaterThan(0.17)
    expect(sampled).toBeLessThan(0.23)
  })

  it('taxa 0 nunca amostra e taxa 1 sempre amostra', () => {
    expect(ids.some((id) => isSampled(id, 0))).toBe(false)
    expect(ids.every((id) => isSampled(id, 1))).toBe(true)
  })

  it('FNV-1a de 32 bits (vetor conhecido)', () => {
    expect(samplingBucket('a')).toBe(0xe4_0c_29_2c / 2 ** 32)
  })
})

describe('projeção mensal', () => {
  it('mês corrente em São Paulo, com a fração do dia', () => {
    expect(monthProgress(MID_NOVEMBER)).toEqual({
      firstDay: '2026-11-01',
      elapsedDays: 14.5,
      daysInMonth: 30,
    })
  })

  it('o dia 1 em São Paulo ainda é o mês anterior em UTC−3 até as 03:00 UTC', () => {
    expect(monthProgress(new Date('2026-12-01T02:00:00Z')).firstDay).toBe('2026-11-01')
    expect(monthProgress(new Date('2026-12-01T04:00:00Z'))).toMatchObject({
      firstDay: '2026-12-01',
      elapsedDays: 1,
      daysInMonth: 31,
    })
  })

  it('linear: usado / dias decorridos × dias do mês (piso de 1 dia)', () => {
    expect(projectMonthlyUnits(14_500, MID_NOVEMBER)).toBe(30_000)
    expect(projectMonthlyUnits(100, new Date('2026-12-01T05:00:00Z'))).toBe(3100)
  })

  it('a taxa cai no corte e com a projeção desconhecida', () => {
    expect(samplingRate(PRODUCTION, 34_999)).toBe(1)
    expect(samplingRate(PRODUCTION, 35_000)).toBe(0.2)
    expect(samplingRate(PRODUCTION, null)).toBe(0.2)
    // A taxa reduzida nunca passa a do ambiente.
    expect(samplingRate(STAGING, 40_000)).toBe(0.1)
  })
})

describe('createTraceSampler', () => {
  const clock = { now: () => MID_NOVEMBER }

  it('produção abaixo do corte amostra tudo e lê o mês desde o dia 1', async () => {
    const unitsSince = vi.fn(async () => 14_000)
    const sampler = createTraceSampler({ policy: PRODUCTION, unitsSince, clock })
    for (const id of ids.slice(0, 50)) {
      expect(await sampler.shouldSample(id)).toBe(true)
    }
    expect(unitsSince).toHaveBeenCalledWith('2026-11-01')
    expect(unitsSince).toHaveBeenCalledTimes(1)
  })

  it('produção acima do corte cai para 0,2', async () => {
    const sampler = createTraceSampler({
      policy: PRODUCTION,
      unitsSince: async () => 20_000,
      clock,
    })
    const results = await Promise.all(ids.map((id) => sampler.shouldSample(id)))
    const ratio = results.filter(Boolean).length / ids.length
    expect(ratio).toBeGreaterThan(0.17)
    expect(ratio).toBeLessThan(0.23)
    expect(results).toEqual(ids.map((id) => isSampled(id, 0.2)))
  })

  it('falha na leitura das units vale como corte atingido', async () => {
    const sampler = createTraceSampler({
      policy: PRODUCTION,
      unitsSince: () => Promise.reject(new Error('banco fora')),
      clock,
    })
    const results = await Promise.all(ids.slice(0, 500).map((id) => sampler.shouldSample(id)))
    expect(results).toEqual(ids.slice(0, 500).map((id) => isSampled(id, 0.2)))
  })

  it('o total do mês fica em cache pelo TTL e é relido depois', async () => {
    let nowMs = MID_NOVEMBER.getTime()
    const unitsSince = vi.fn(async () => 1)
    const sampler = createTraceSampler({
      policy: PRODUCTION,
      unitsSince,
      clock: { now: () => new Date(nowMs) },
    })
    await sampler.shouldSample('a')
    nowMs += UNITS_CACHE_TTL_MS - 1
    await sampler.shouldSample('b')
    expect(unitsSince).toHaveBeenCalledTimes(1)
    nowMs += 1
    await sampler.shouldSample('c')
    expect(unitsSince).toHaveBeenCalledTimes(2)
  })

  it('staging amostra 0,1 sem ler o banco; CI nunca amostra', async () => {
    const unitsSince = vi.fn(async () => 0)
    const staging = createTraceSampler({ policy: STAGING, unitsSince, clock })
    const results = await Promise.all(ids.map((id) => staging.shouldSample(id)))
    expect(results).toEqual(ids.map((id) => isSampled(id, 0.1)))
    const ci = createTraceSampler({ policy: CI, unitsSince, clock })
    expect(await Promise.all(ids.slice(0, 100).map((id) => ci.shouldSample(id)))).not.toContain(
      true,
    )
    expect(unitsSince).not.toHaveBeenCalled()
  })
})

describe('QueryTracer', () => {
  it('não amostrada: trace inerte, sem chamar o adapter', async () => {
    const port = recordingLlmTracing()
    const trace = await createQueryTracer({
      port,
      sampler: { shouldSample: async () => false },
    }).start(START)
    expect(trace).toBe(untracedQuery)
    expect(port.queries).toEqual([])
    expect(await disabledQueryTracer.start(START)).toBe(untracedQuery)
  })

  it('conta as units: trace + raiz + cada observation', async () => {
    const port = recordingLlmTracing()
    const trace = await createQueryTracer({
      port,
      sampler: { shouldSample: async () => true },
    }).start(START)
    expect(trace.traceId).toBe('trace-1')
    expect(trace.units()).toBe(2)
    trace.retrieval(1).end(
      {
        mode: 'hybrid',
        topK: 0,
        candidatesByChannel: { lexical: 0, semantic: 0, reference: 0 },
        rrf: [],
        reranked: false,
        rewritten: false,
        uncoveredFamilies: [],
        refusalReason: null,
      },
      2,
    )
    trace
      .generation({
        name: 'answer',
        provider: 'gemini',
        model: 'm',
        input: 'p',
        temperature: 0.1,
        maxOutputTokens: 10,
        startedAtMs: 3,
      })
      .end({
        error: null,
        usage: { inputTokens: 1, outputTokens: 1 },
        cost: { input: 0, output: 0, total: 0 },
        firstTokenAtMs: 4,
        output: 'x',
        endedAtMs: 5,
      })
    expect(trace.units()).toBe(4)
    const end = {
      outcome: 'answered',
      refusalReason: null,
      answer: 'x',
      citations: 1,
      corpusVersion: 3,
      endedAtMs: 6,
    }
    trace.end(end)
    trace.end({ ...end, outcome: 'failed' })
    expect(port.queries[0]?.end).toEqual(end)
  })

  it('falha do adapter nunca chega à resposta', async () => {
    const throwing: LlmTracingPort = {
      startQuery: () => {
        throw new Error('sdk quebrado')
      },
    }
    const sampler = { shouldSample: async () => true }
    expect(await createQueryTracer({ port: throwing, sampler }).start(START)).toBe(untracedQuery)

    const broken: LlmTracingPort = {
      startQuery: () => ({
        traceId: 't',
        retrieval: () => {
          throw new Error('x')
        },
        generation: () => {
          throw new Error('x')
        },
        end: () => {
          throw new Error('x')
        },
      }),
    }
    const trace = await createQueryTracer({ port: broken, sampler }).start(START)
    expect(() => {
      trace.retrieval(0).end(
        {
          mode: null,
          topK: 0,
          candidatesByChannel: { lexical: 0, semantic: 0, reference: 0 },
          rrf: [],
          reranked: false,
          rewritten: false,
          uncoveredFamilies: [],
          refusalReason: null,
        },
        1,
      )
      trace
        .generation({
          name: 'answer',
          provider: 'groq',
          model: 'm',
          input: '',
          temperature: 0,
          maxOutputTokens: 1,
          startedAtMs: 0,
        })
        .end({
          error: 'x',
          usage: { inputTokens: 0, outputTokens: 0 },
          cost: { input: 0, output: 0, total: 0 },
          firstTokenAtMs: null,
          output: null,
          endedAtMs: 1,
        })
      trace.end({
        outcome: 'failed',
        refusalReason: null,
        answer: null,
        citations: 0,
        corpusVersion: null,
        endedAtMs: 1,
      })
    }).not.toThrow()
    expect(trace.units()).toBe(4)
  })
})
