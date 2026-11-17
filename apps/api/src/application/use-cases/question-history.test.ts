import { CONVERSATIONS_PAGE_SIZE } from '@teko/shared/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import type { TraceFeedbackPort } from '../ports/llm-tracing.ts'
import type {
  ConversationRecord,
  DeleteConversationOutcome,
  QuestionRecord,
  QuestionRepository,
  SavedFeedback,
} from '../ports/question-repository.ts'
import { recordingTraceFeedback } from '../ports/testing/recording-llm-tracing.ts'
import {
  conversationTitle,
  createQuestionHistory,
  decodeConversationCursor,
  encodeConversationCursor,
  toDetail,
} from './question-history.ts'

const CONVERSATION_ID = '0192f1c4-7a2b-7c3d-8e4f-000000000001'

function conversation(index: number): ConversationRecord {
  return {
    conversationId: `0192f1c4-7a2b-7c3d-8e4f-${String(index).padStart(12, '0')}`,
    firstQuestion: `Pergunta ${index}`,
    questionCount: index + 1,
    lastAskedAt: '2026-11-10T15:00:00.123456Z',
    lastReferenceDate: '2008-05-01',
  }
}

const RECORD: QuestionRecord = {
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
  cacheKey: null,
  corpusVersion: 14,
  status: 'refused',
  answer: null,
  refusal: { reason: 'out_of_coverage' },
  createdAt: new Date('2026-11-10T15:00:00Z'),
}

function setup(
  record: QuestionRecord | null = RECORD,
  feedbackSaved: SavedFeedback | null = { langfuseTraceId: null },
  conversations: ConversationRecord[] = [],
  traceFeedback?: { port: TraceFeedbackPort; tasks: BackgroundTasks },
) {
  const questions = {
    get: vi.fn(async () => record),
    listByConversation: vi.fn(async () => (record === null ? [] : [record])),
    listConversations: vi.fn(async () => conversations),
    recordFeedback: vi.fn(async () => feedbackSaved),
    usage: vi.fn(async () => ({
      globalRequests: 12,
      userRequests: 3,
      globalStreamSeconds: 0,
      globalNeurons: 0,
      activeStream: false,
    })),
  } as unknown as QuestionRepository
  const history = createQuestionHistory({
    questions,
    clock: { now: () => new Date('2026-11-10T15:00:00Z') },
    caps: {
      questionsGlobal: 300,
      questionsPerUser: 30,
      streamSecondsGlobal: 6000,
      neuronsGlobal: 800,
    },
    ...(traceFeedback === undefined ? {} : { traceFeedback }),
  })
  return { history, questions }
}

function recordingTasks() {
  const runs: { name: string; task: Promise<unknown>; timeoutMs: number }[] = []
  const tasks: BackgroundTasks = {
    run: (name, task, options) => {
      runs.push({ name, task, timeoutMs: options.timeoutMs })
    },
    pending: () => 0,
    drain: async () => 0,
  }
  return { tasks, runs }
}

describe('feedback no Langfuse', () => {
  it('pergunta amostrada: score e annotation queue em tarefa pós-resposta com teto', async () => {
    const port = recordingTraceFeedback()
    const { tasks, runs } = recordingTasks()
    const { history } = setup(RECORD, { langfuseTraceId: 'abc' }, [], { port, tasks })
    await history.recordFeedback('u1', 'q1', { rating: 'down', reason: 'wrong_citation' })
    expect(runs.map(({ name, timeoutMs }) => [name, timeoutMs])).toEqual([
      ['langfuse-feedback', 2000],
    ])
    expect(port.calls).toEqual([
      { traceId: 'abc', questionId: 'q1', rating: 'down', reason: 'wrong_citation' },
    ])
  })

  it('pergunta sem trace: nada vai ao Langfuse', async () => {
    const port = recordingTraceFeedback()
    const { tasks, runs } = recordingTasks()
    const { history } = setup(RECORD, { langfuseTraceId: null }, [], { port, tasks })
    await history.recordFeedback('u1', 'q1', { rating: 'up' })
    expect(runs).toEqual([])
    expect(port.calls).toEqual([])
  })

  it('falha do Langfuse não chega à requisição: fica na tarefa', async () => {
    const port = recordingTraceFeedback()
    port.fail = true
    const { tasks, runs } = recordingTasks()
    const { history } = setup(RECORD, { langfuseTraceId: 'abc' }, [], { port, tasks })
    await expect(history.recordFeedback('u1', 'q1', { rating: 'up' })).resolves.toBeUndefined()
    await expect(runs[0]?.task).rejects.toThrow('langfuse fora')
  })
})

describe('createQuestionHistory', () => {
  it('detalhe e lista no formato do contrato', async () => {
    const { history } = setup()
    const detail = await history.get('u1', 'q1')
    expect(detail).toEqual(toDetail(RECORD))
    expect(detail).toMatchObject({
      question: 'Qual o prazo?',
      createdAt: '2026-11-10T15:00:00.000Z',
    })
    expect((await history.list('u1', 'c1')).items).toHaveLength(1)
  })

  it('pergunta inexistente (ou de outro usuário) → not_found', async () => {
    const { history } = setup(null, null)
    await expect(history.get('u1', 'q9')).rejects.toMatchObject({ problem: { code: 'not_found' } })
    await expect(history.recordFeedback('u1', 'q9', { rating: 'up' })).rejects.toMatchObject({
      problem: { code: 'not_found' },
    })
  })

  it('feedback sem motivo grava null', async () => {
    const { history, questions } = setup()
    await history.recordFeedback('u1', 'q1', { rating: 'up' })
    expect(questions.recordFeedback).toHaveBeenCalledWith('q1', 'u1', 'up', null)
  })

  it('cota do dia de São Paulo', async () => {
    const { history } = setup()
    await expect(history.quota('u1')).resolves.toEqual({
      day: '2026-11-10',
      user: { used: 3, limit: 30 },
      global: { used: 12, limit: 300 },
      resetAt: '2026-11-11T03:00:00.000Z',
    })
  })
})

describe('lista de conversas', () => {
  it('última página: sem cursor seguinte, título e instante no formato do contrato', async () => {
    const { history, questions } = setup(RECORD, undefined, [conversation(1)])
    await expect(history.conversations('u1')).resolves.toEqual({
      items: [
        {
          conversationId: conversation(1).conversationId,
          title: 'Pergunta 1',
          questionCount: 2,
          updatedAt: '2026-11-10T15:00:00.123Z',
          lastReferenceDate: '2008-05-01',
        },
      ],
      nextCursor: null,
    })
    expect(questions.listConversations).toHaveBeenCalledWith(
      'u1',
      null,
      CONVERSATIONS_PAGE_SIZE + 1,
    )
  })

  it('pede um a mais que a página e devolve o cursor da última conversa mostrada', async () => {
    const rows = Array.from({ length: CONVERSATIONS_PAGE_SIZE + 1 }, (_, index) =>
      conversation(index),
    )
    const { history, questions } = setup(RECORD, undefined, rows)
    const page = await history.conversations('u1')
    expect(page.items).toHaveLength(CONVERSATIONS_PAGE_SIZE)
    const last = rows[CONVERSATIONS_PAGE_SIZE - 1] as ConversationRecord
    expect(page.nextCursor).not.toBeNull()
    expect(decodeConversationCursor(page.nextCursor ?? '')).toEqual({
      lastAskedAt: last.lastAskedAt,
      conversationId: last.conversationId,
    })

    await history.conversations('u1', page.nextCursor ?? undefined)
    expect(questions.listConversations).toHaveBeenLastCalledWith(
      'u1',
      { lastAskedAt: last.lastAskedAt, conversationId: last.conversationId },
      CONVERSATIONS_PAGE_SIZE + 1,
    )
  })

  it('cursor que a API não emitiu → validation_error, sem tocar o banco', async () => {
    const { history, questions } = setup()
    for (const cursor of [
      'lixo',
      Buffer.from(`2026-11-10T15:00:00Z|${CONVERSATION_ID}`).toString('base64url'),
      Buffer.from('2026-11-10T15:00:00.123456Z|nao-e-uuid').toString('base64url'),
      Buffer.from(`2026-11-10T15:00:00.123456Z|${CONVERSATION_ID}|x`).toString('base64url'),
    ]) {
      await expect(history.conversations('u1', cursor)).rejects.toMatchObject({
        problem: { code: 'validation_error' },
      })
    }
    expect(questions.listConversations).not.toHaveBeenCalled()
  })
})

describe('exclusão de uma conversa', () => {
  function withOutcome(outcome: DeleteConversationOutcome) {
    const { history, questions } = setup()
    const deleteConversation = vi.fn(async () => outcome)
    Object.assign(questions, { deleteConversation })
    return { history, questions, deleteConversation }
  }

  it('apaga as perguntas do dono e não mexe na cota', async () => {
    const { history, questions, deleteConversation } = withOutcome({
      kind: 'deleted',
      questions: 3,
    })
    await expect(history.deleteConversation('u1', CONVERSATION_ID)).resolves.toBeUndefined()
    expect(deleteConversation).toHaveBeenCalledWith('u1', CONVERSATION_ID)
    expect(questions.usage).not.toHaveBeenCalled()
  })

  it('inexistente ou de outro usuário → o mesmo not_found', async () => {
    const { history } = withOutcome({ kind: 'not_found' })
    await expect(history.deleteConversation('u2', CONVERSATION_ID)).rejects.toMatchObject({
      problem: { code: 'not_found', detail: 'Conversation not found' },
    })
  })

  it('com uma resposta em stream → 409 stream_busy', async () => {
    const { history } = withOutcome({ kind: 'busy' })
    await expect(history.deleteConversation('u1', CONVERSATION_ID)).rejects.toMatchObject({
      problem: { code: 'stream_busy' },
    })
  })
})

describe('cursor e título', () => {
  it('o cursor vai e volta', () => {
    const cursor = { lastAskedAt: '2026-11-10T15:00:00.000001Z', conversationId: CONVERSATION_ID }
    const encoded = encodeConversationCursor(cursor)
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeConversationCursor(encoded)).toEqual(cursor)
  })

  it('título em uma linha, cortado na palavra com reticências', () => {
    expect(conversationTitle('  Qual o\n prazo?  ')).toBe('Qual o prazo?')
    expect(conversationTitle('   ')).toBe('…')
    const long = `${'palavra '.repeat(12)}fim`
    const title = conversationTitle(long)
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('palavra…')).toBe(true)
    expect(conversationTitle('a'.repeat(80))).toBe('a'.repeat(80))
    expect(conversationTitle('a'.repeat(200))).toBe(`${'a'.repeat(79)}…`)
  })
})
