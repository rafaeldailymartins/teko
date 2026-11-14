import { parseStreamError, type TekoStreamChunk } from '@teko/shared/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { SessionUser } from '../ports/auth-gateway.ts'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import type { LlmEvent, LlmModel, LlmRequest } from '../ports/llm-port.ts'
import type {
  ClaimedQuestion,
  ClaimOutcome,
  QuestionRepository,
  StreamResult,
} from '../ports/question-repository.ts'
import { createProviderRouter } from '../services/provider-router.ts'
import type { RetrieveEvidence } from './retrieve-evidence.ts'
import { createStreamAnswer, resultOf, StreamTimeoutError } from './stream-answer.ts'

const USER = { id: 'u1' } as SessionUser
const QUESTION: ClaimedQuestion = {
  id: 'q1',
  userId: 'u1',
  conversationId: 'c1',
  questionRedacted: 'Qual o prazo?',
  locale: 'pt-BR',
  families: ['rcte'],
  referenceDate: '2006-05-01',
  referenceSource: 'periodo_apuracao',
  referenceInput: { periodoApuracao: '2006-05' },
  requestId: 'r1',
  zeroDataRetention: false,
  cacheKey: 'key',
  corpusVersion: 14,
}

const RETRIEVE: RetrieveEvidence = async () => ({
  outcome: 'evidence',
  reference: {
    value: '2006-05-01',
    source: 'periodo_apuracao',
    periodBoundaryInside: false,
    alternatives: [],
    periodo: '2006-05',
  },
  mode: 'hybrid',
  evidence: [
    {
      chunkId: 'c',
      stableKey: 'go:rcte:art:76',
      family: 'rcte',
      citationLabel: 'RCTE, art. 76',
      headingPath: 'RCTE > Art. 76',
      ancestors: [],
      content: 'texto',
      validity: { from: '2005-01-01', to: null },
      document: {
        versionId: 'v',
        versionLabel: 'consolidado',
        title: 'RCTE',
        sourceUrl: 'https://appasp.economia.go.gov.br/x.htm',
      },
      rrf: 0.03,
      lexicalRank: 1,
      semanticRank: null,
      referenceRank: null,
    },
  ],
  uncoveredFamilies: [],
  stableKeys: [],
  rewrittenQuery: null,
})

type Script = 'answer' | 'hang' | 'boom'

function model(script: Script): LlmModel {
  return {
    provider: 'fake',
    model: 'fake-llm-1',
    zeroDataRetention: true,
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      if (script === 'boom') {
        throw new TypeError('bug')
      }
      if (script === 'hang') {
        yield { type: 'text', text: 'começo ' }
        await new Promise((_resolve, reject) => {
          if (request.signal.aborted) {
            reject(request.signal.reason)
            return
          }
          request.signal.addEventListener('abort', () => reject(request.signal.reason), {
            once: true,
          })
        })
      }
      yield { type: 'text', text: 'Vale [S1].' }
      yield { type: 'finish', usage: { inputTokens: 10, outputTokens: 3 } }
    },
  }
}

function setup(
  options: { claim?: ClaimOutcome; script?: Script; timeoutMs?: number; draining?: boolean } = {},
) {
  const finished: { id: string; result: StreamResult }[] = []
  const background: { name: string; task: Promise<unknown> }[] = []
  const questions = {
    claim: vi.fn(async () => options.claim ?? { kind: 'claimed', question: QUESTION }),
    finish: vi.fn(async (id: string, _reservation: unknown, result: StreamResult) => {
      finished.push({ id, result })
    }),
  } as unknown as QuestionRepository
  const backgroundTasks: BackgroundTasks = {
    run: (name, task) => {
      background.push({ name, task })
    },
    pending: () => 0,
    drain: async () => 0,
  }
  let now = 0
  const stream = createStreamAnswer({
    questions,
    pipeline: {
      retrieveEvidence: RETRIEVE,
      router: createProviderRouter({
        models: [model(options.script ?? 'answer')],
        clock: { now: () => new Date(0) },
      }),
      corpusVersion: async () => 14,
      nowMs: () => now,
    },
    clock: {
      now: () => {
        now += 250
        return new Date(now)
      },
    },
    streamBudget: { timeoutMs: () => options.timeoutMs ?? 60_000 },
    lifecycle: { isDraining: () => options.draining ?? false },
    backgroundTasks,
    reservation: { streamSeconds: 100, neurons: 5 },
    cacheTtlMs: 1000,
  })
  return { stream, finished, background, questions }
}

async function collect(chunks: AsyncIterable<TekoStreamChunk>): Promise<TekoStreamChunk[]> {
  const out: TekoStreamChunk[] = []
  for await (const chunk of chunks) {
    out.push(chunk)
  }
  return out
}

const command = (signal = new AbortController().signal) => ({
  user: USER,
  questionId: 'q1',
  signal,
  startedAtMs: 0,
  traceId: 'trace-1',
})

describe('createStreamAnswer', () => {
  it('grava a resposta e o cache antes do finish', async () => {
    const { stream, finished } = setup()
    const chunks = await collect(await stream(command()))
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      messageMetadata: {
        usage: { inputTokens: 10, outputTokens: 3 },
        model: 'fake-llm-1',
        traceId: 'trace-1',
      },
    })
    expect(finished).toHaveLength(1)
    expect(finished[0]?.result).toMatchObject({
      status: 'answered',
      model: 'fake-llm-1',
      provider: 'fake',
      inputTokens: 10,
      cache: { key: 'key' },
      meta: { corpusVersion: 14 },
    })
  })

  it.each([
    [{ kind: 'not_found' } as const, 'not_found'],
    [{ kind: 'busy' } as const, 'stream_busy'],
  ])('claim %o → %s', async (claim, code) => {
    await expect(setup({ claim }).stream(command())).rejects.toMatchObject({ problem: { code } })
  })

  it('em drenagem não começa stream novo', async () => {
    const { stream, questions } = setup({ draining: true })
    await expect(stream(command())).rejects.toMatchObject({ problem: { code: 'service_paused' } })
    expect(questions.claim).not.toHaveBeenCalled()
  })

  it('teto estourado → error upstream_unavailable retryable e pergunta failed', async () => {
    const { stream, finished } = setup({ script: 'hang', timeoutMs: 20 })
    const chunks = await collect(await stream(command()))
    const last = chunks.at(-1)
    expect(parseStreamError(last?.type === 'error' ? last.errorText : '')).toEqual({
      code: 'upstream_unavailable',
      retryable: true,
    })
    expect(finished[0]?.result.status).toBe('failed')
  })

  it('erro inesperado → error internal', async () => {
    const { stream } = setup({ script: 'boom' })
    const chunks = await collect(await stream(command()))
    const last = chunks.at(-1)
    expect(parseStreamError(last?.type === 'error' ? last.errorText : '')).toEqual({
      code: 'internal',
      retryable: true,
    })
  })

  it('desconexão do cliente: sem chunk de erro, aborted gravado em tarefa pós-resposta', async () => {
    const controller = new AbortController()
    const { stream, finished, background } = setup({ script: 'hang' })
    const chunks: TekoStreamChunk[] = []
    for await (const chunk of await stream(command(controller.signal))) {
      chunks.push(chunk)
      if (chunk.type === 'text-delta' || chunk.type === 'text-start') {
        controller.abort(new Error('cliente saiu'))
      }
    }
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false)
    expect(background.map((task) => task.name)).toEqual(['question-aborted'])
    await background[0]?.task
    expect(finished[0]?.result.status).toBe('aborted')
  })
})

describe('resultOf', () => {
  it('recusa não vai para o cache e mantém a corpus_version da pergunta', () => {
    const result = resultOf(
      { ...QUESTION, cacheKey: null },
      {
        answer: null,
        refusal: { reason: 'no_evidence' },
        retrievalMode: 'hybrid',
        provider: null,
        model: null,
        usage: { inputTokens: 0, outputTokens: 0 },
        firstTokenAtMs: null,
      },
      { startedMs: 0, endedMs: 1500 },
      1000,
    )
    expect(result).toMatchObject({
      status: 'refused',
      cache: null,
      corpusVersion: 14,
      ttftMs: null,
      streamSeconds: 2,
      latencyMs: 1500,
      shadowCostUsd: 0,
    })
  })

  it('StreamTimeoutError tem nome próprio', () => {
    expect(new StreamTimeoutError().name).toBe('StreamTimeoutError')
  })
})
