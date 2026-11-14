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
import type { ProviderRouter } from '../services/provider-router.ts'
import { createAskQuestion, quotaDay, quotaExceeded } from './ask-question.ts'

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

function setup(options: Options = {}) {
  const decisions: AcceptDecision[] = []
  const questions = {
    insertFinished: vi.fn(async () => 'q-finished'),
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
  })
  const command = {
    user: options.user ?? USER,
    request: REQUEST,
    requestId: 'req-1',
    requestCountry: null,
  }
  return { ask: () => ask(command), questions, decisions }
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
    const { ask, questions } = setup({ coverage: { ...COVERED, status: 'out_of_coverage' } })
    await expect(ask()).resolves.toMatchObject({
      status: 'refused',
      questionId: 'q-finished',
      refusal: { reason: 'out_of_coverage', coverage: [] },
    })
    expect(questions.accept).not.toHaveBeenCalled()
  })

  it('acerto do cache responde com meta.cached, sem cota', async () => {
    const { ask, questions } = setup({ cached: CACHED })
    await expect(ask()).resolves.toMatchObject({
      status: 'answered',
      answer: { meta: { cached: true } },
    })
    expect(questions.accept).not.toHaveBeenCalled()
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
