import { describe, expect, it, vi } from 'vitest'
import type { QuestionRecord, QuestionRepository } from '../ports/question-repository.ts'
import { createQuestionHistory, toDetail } from './question-history.ts'

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

function setup(record: QuestionRecord | null = RECORD, feedbackSaved = true) {
  const questions = {
    get: vi.fn(async () => record),
    listByConversation: vi.fn(async () => (record === null ? [] : [record])),
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
  })
  return { history, questions }
}

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
    const { history } = setup(null, false)
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
