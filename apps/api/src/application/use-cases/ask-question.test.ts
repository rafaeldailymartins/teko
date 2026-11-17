import type { Answer, AskQuestionRequest } from '@teko/shared/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { CoverageDecision } from '#domain/vigencia/coverage-decision.ts'
import type { ReferenceResolution } from '#domain/vigencia/reference-resolution.ts'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type {
  AcceptDecision,
  QuestionRepository,
  UsageSnapshot,
} from '../ports/question-repository.ts'
import { recordingLlmTracing } from '../ports/testing/recording-llm-tracing.ts'
import { recordingTelemetry } from '../ports/testing/recording-telemetry.ts'
import type { ProviderRouter } from '../services/provider-router.ts'
import { createQueryTracer } from '../services/trace-sampler.ts'
import { type AskQuestionDeps, createAskQuestion, quotaDay, quotaExceeded } from './ask-question.ts'

const NOW = new Date('2026-11-10T15:00:00Z')
const USER: SessionUser = {
  id: '0195f3c4-0000-7000-8000-000000000001',
  name: 'Ana',
  email: 'ana@example.com',
  image: null,
  isAdult: true,
  termsVersion: '2026-11-14',
  termsAcceptedAt: NOW,
  countryOfResidence: 'BR',
}
const REQUEST: AskQuestionRequest = {
  conversationId: '0195f3c4-0000-7000-8000-0000000000aa',
  question: 'Qual o prazo? Meu CPF é 529.982.247-25.',
  locale: 'pt-BR',
  families: ['rcte'],
  periodoApuracao: '2006-05',
  source: 'periodo_apuracao',
}
const RESOLVED: ReferenceResolution = {
  kind: 'resolved',
  reference: {
    value: '2006-05-01',
    source: 'periodo_apuracao',
    periodBoundaryInside: false,
    alternatives: [],
    periodo: '2006-05',
  },
}
const COVERED: CoverageDecision = {
  status: 'covered',
  coveredFamilies: ['rcte'],
  uncoveredFamilies: [],
  coverage: [],
}
const IDLE: UsageSnapshot = {
  globalRequests: 0,
  userRequests: 0,
  globalStreamSeconds: 0,
  globalNeurons: 0,
  activeStream: false,
}
const CACHED: Answer = {
  markdown: 'Vale [S1](cite:S1).',
  citations: [],
  meta: {
    corpusVersion: 14,
    retrievalMode: 'hybrid',
    uncoveredFamilies: [],
    provider: 'gemini',
    fallbackFrom: null,
    cached: false,
  },
}

interface Options {
  readonly resolution?: ReferenceResolution
  readonly coverage?: CoverageDecision
  readonly cached?: Answer | null
  readonly usage?: UsageSnapshot
  readonly killSwitch?: boolean
  readonly draining?: boolean
  readonly zdrModel?: boolean
  readonly available?: readonly string[]
  readonly user?: SessionUser
}

function setup(options: Options = {}, tracing?: AskQuestionDeps['tracing']) {
  const decisions: AcceptDecision[] = []
  const telemetry = recordingTelemetry()
  const questions = {
    insertFinished: vi.fn(async () => 'q-finished'),
    recordTrace: vi.fn(async () => {}),
    accept: vi.fn<QuestionRepository['accept']>(async (_question, _day, _reservation, decide) => {
      const decision = decide(options.usage ?? IDLE)
      decisions.push(decision)
      return decision.kind === 'ok' ? { kind: 'accepted', questionId: 'q-accepted' } : decision
    }),
    cachedAnswer: vi.fn(async () => options.cached ?? null),
  } as unknown as QuestionRepository
  const router = {
    available: () => options.available ?? ['gemini'],
    hasZeroRetentionModel: () => options.zdrModel ?? true,
    stream: () => {
      throw new Error('não usado')
    },
  } satisfies ProviderRouter
  const ask = createAskQuestion({
    questions,
    resolveReferenceDate: () => options.resolution ?? RESOLVED,
    checkCoverage: async () => options.coverage ?? COVERED,
    coverage: async () => ({ corpusVersion: 14, families: [] }),
    router,
    hasher: { hash: (text) => `hash(${text})` },
    clock: { now: () => new Date(NOW) },
    lifecycle: { isDraining: () => options.draining ?? false },
    caps: {
      questionsGlobal: 300,
      questionsPerUser: 30,
      streamSecondsGlobal: 6000,
      neuronsGlobal: 800,
    },
    reservation: { streamSeconds: 100, neurons: 5 },
    killSwitch: options.killSwitch ?? false,
    telemetry,
    ...(tracing === undefined ? {} : { tracing }),
  })
  const command = {
    user: options.user ?? USER,
    request: REQUEST,
    requestId: 'req-1',
    requestCountry: null,
  }
  return { ask: () => ask(command), questions, decisions, telemetry }
}

describe('createAskQuestion', () => {
  it('aceita, com a pergunta redigida e a chave do cache gravadas', async () => {
    const { ask, questions } = setup()
    await expect(ask()).resolves.toEqual({
      status: 'accepted',
      questionId: 'q-accepted',
      resolved: {
        value: '2006-05-01',
        source: 'periodo_apuracao',
        periodBoundaryInside: false,
        alternatives: [],
      },
    })
    const [question, day, reservation] = vi.mocked(questions.accept).mock.calls[0] ?? []
    expect(question).toMatchObject({
      questionRedacted: 'Qual o prazo? Meu CPF é [CPF].',
      referenceInput: { periodoApuracao: '2006-05' },
      zeroDataRetention: false,
      corpusVersion: 14,
      requestId: 'req-1',
    })
    expect(question?.cacheKey).toContain('qual o prazo? meu cpf é [cpf]|2006-05-01|14|answer@')
    expect(day).toBe('2026-11-10')
    expect(reservation).toEqual({ streamSeconds: 100, neurons: 5 })
  })

  it('referenceDate também vira a entrada gravada', async () => {
    const { questions } = setup()
    const ask = createAskQuestion({
      questions,
      resolveReferenceDate: () => RESOLVED,
      checkCoverage: async () => COVERED,
      coverage: async () => ({ corpusVersion: 1, families: [] }),
      router: {
        available: () => ['x'],
        hasZeroRetentionModel: () => true,
        stream: () => [][Symbol.iterator]() as never,
      },
      hasher: { hash: (text) => text },
      clock: { now: () => new Date(NOW) },
      lifecycle: { isDraining: () => false },
      caps: {
        questionsGlobal: 1,
        questionsPerUser: 1,
        streamSecondsGlobal: 1000,
        neuronsGlobal: 100,
      },
      reservation: { streamSeconds: 100, neurons: 5 },
      killSwitch: false,
    })
    await ask({
      user: USER,
      request: {
        ...REQUEST,
        periodoApuracao: undefined,
        referenceDate: '2006-05-10',
        source: 'explicit',
        families: undefined,
      },
      requestId: 'r',
      requestCountry: 'PT',
    })
    expect(vi.mocked(questions.accept).mock.calls[0]?.[0]).toMatchObject({
      referenceInput: { referenceDate: '2006-05-10' },
      families: [],
      zeroDataRetention: true,
    })
  })

  it('em drenagem → service_paused', async () => {
    await expect(setup({ draining: true }).ask()).rejects.toMatchObject({
      problem: { code: 'service_paused' },
    })
  })

  it('esclarecimento sai sem gravar', async () => {
    const { ask, questions } = setup({
      resolution: {
        kind: 'needs_clarification',
        reason: 'ambiguous_text',
        candidates: ['2024-03-01', '2024-05-01'],
      },
    })
    await expect(ask()).resolves.toEqual({
      status: 'needs_clarification',
      reason: 'ambiguous_text',
      candidates: ['2024-03-01', '2024-05-01'],
    })
    expect(questions.insertFinished).not.toHaveBeenCalled()
  })

  it('fora da cobertura: grava a recusa sem passar pela cota', async () => {
    const { ask, questions, telemetry } = setup({
      coverage: { ...COVERED, status: 'out_of_coverage' },
    })
    await expect(ask()).resolves.toMatchObject({
      status: 'refused',
      questionId: 'q-finished',
      refusal: { reason: 'out_of_coverage', coverage: [] },
    })
    expect(questions.accept).not.toHaveBeenCalled()
    expect(telemetry.calls).toEqual([
      {
        method: 'answer',
        args: [
          {
            outcome: 'refused',
            refusalReason: 'out_of_coverage',
            retrievalMode: null,
            cached: false,
            corpusVersion: 14,
          },
        ],
      },
    ])
  })

  it('acerto do cache responde com meta.cached, sem cota', async () => {
    const { ask, questions, telemetry } = setup({ cached: CACHED })
    await expect(ask()).resolves.toMatchObject({
      status: 'answered',
      answer: { meta: { cached: true } },
    })
    expect(questions.accept).not.toHaveBeenCalled()
    expect(telemetry.calls).toEqual([
      {
        method: 'answer',
        args: [
          {
            outcome: 'answered',
            refusalReason: null,
            retrievalMode: CACHED.meta.retrievalMode,
            cached: true,
            corpusVersion: 14,
          },
        ],
      },
    ])
  })

  it.each([
    [{ killSwitch: true }, 'service_paused'],
    [{ zdrModel: false, user: { ...USER, countryOfResidence: 'DE' } }, 'region_restricted'],
    [{ available: [] }, 'upstream_unavailable'],
    [{ usage: { ...IDLE, activeStream: true } }, 'stream_busy'],
  ] as const)('%o → %s', async (options, code) => {
    await expect(setup(options).ask()).rejects.toMatchObject({ problem: { code } })
  })

  it('cota estourada → quota_exceeded com o escopo e a hora de reset', async () => {
    await expect(setup({ usage: { ...IDLE, userRequests: 30 } }).ask()).rejects.toMatchObject({
      problem: {
        code: 'quota_exceeded',
        meta: { scope: 'user_daily', resetAt: '2026-11-11T03:00:00.000Z' },
      },
    })
  })
})

describe('cota no Grafana', () => {
  it('o uso global do dia vai para a métrica junto com a decisão', async () => {
    const { ask, telemetry } = setup({ usage: { ...IDLE, globalRequests: 30 } })
    await ask()
    expect(telemetry.of('quotaUsage')).toEqual([
      [
        [
          { scope: 'global_questions', ratio: 0.1 },
          { scope: 'global_stream_seconds', ratio: 0 },
          { scope: 'global_neurons', ratio: 0 },
        ],
      ],
    ])
  })
})

describe('trace answer-question das perguntas encerradas no POST', () => {
  function tracedSetup(options: Options, sampled = true) {
    const port = recordingLlmTracing()
    const runs: { name: string; task: Promise<unknown> }[] = []
    const base = setup(options, {
      tracer: createQueryTracer({ port, sampler: { shouldSample: async () => sampled } }),
      tasks: {
        run: (name, task) => {
          runs.push({ name, task })
        },
        pending: () => 0,
        drain: async () => 0,
      },
    })
    return { ...base, port, runs }
  }

  it('cache hit: só a raiz (2 units), com a pergunta redigida, e o trace_id gravado depois', async () => {
    const citation = { id: 'S1', valid: true } as Answer['citations'][number]
    const cached = {
      ...CACHED,
      citations: [citation, { ...citation, id: 'S2', valid: false }],
    }
    const { ask, port, runs, questions } = tracedSetup({ cached })
    await ask()
    expect(port.queries).toHaveLength(1)
    const [query] = port.queries
    expect(query?.start).toMatchObject({
      questionId: 'q-finished',
      userId: USER.id,
      conversationId: '0195f3c4-0000-7000-8000-0000000000aa',
      cached: true,
      corpusVersion: 14,
      referenceSource: 'periodo_apuracao',
    })
    expect(query?.start.question).not.toContain('529.982.247-25')
    expect(query?.retrievals).toEqual([])
    expect(query?.generations).toEqual([])
    expect(query?.end).toMatchObject({
      outcome: 'answered',
      answer: CACHED.markdown,
      citations: cached.citations,
    })
    expect(runs.map((run) => run.name)).toEqual(['langfuse-trace'])
    await runs[0]?.task
    expect(questions.recordTrace).toHaveBeenCalledWith('q-finished', 'trace-1', 2)
  })

  it('fora da cobertura: trace refused sem LLM', async () => {
    const { ask, port } = tracedSetup({
      coverage: { ...COVERED, status: 'out_of_coverage', coveredFamilies: [] },
    })
    await ask()
    expect(port.queries[0]?.start.cached).toBe(false)
    expect(port.queries[0]?.end).toMatchObject({
      outcome: 'refused',
      refusalReason: 'out_of_coverage',
      answer: null,
      citations: [],
    })
  })

  it('não amostrada ou aceita para o stream: nada no POST', async () => {
    const skipped = tracedSetup({ cached: CACHED }, false)
    await skipped.ask()
    expect(skipped.port.queries).toEqual([])
    expect(skipped.runs).toEqual([])
    const accepted = tracedSetup({})
    await accepted.ask()
    expect(accepted.port.queries).toEqual([])
  })
})

describe('auxiliares', () => {
  it('quotaDay usa o dia de São Paulo', () => {
    expect(quotaDay({ now: () => new Date('2026-11-11T02:30:00Z') })).toEqual({
      day: '2026-11-10',
      resetAt: '2026-11-11T03:00:00.000Z',
    })
  })

  it('quotaExceeded monta o erro do contrato', () => {
    expect(quotaExceeded('global_daily', 'x').problem).toEqual({
      code: 'quota_exceeded',
      meta: { scope: 'global_daily', resetAt: 'x' },
    })
  })
})
