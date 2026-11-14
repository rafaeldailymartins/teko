import {
  type FeedbackRequest,
  HISTORY_PAGE_SIZE,
  type HistoryResponse,
  type QuestionDetail,
  type QuotaResponse,
} from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type { Clock } from '../ports/clock.ts'
import type { QuestionRecord, QuestionRepository, UsageCaps } from '../ports/question-repository.ts'
import { quotaDay } from './ask-question.ts'

/**
 * Leituras e o feedback das perguntas do usuário: detalhe (`GET /questions/:id`, que também serve
 * para reler uma resposta depois de uma desconexão), histórico da conversa, polegar com motivo e a
 * cota do dia. Cada leitura filtra pelo dono: pergunta de outro usuário é 404.
 */
export interface QuestionHistory {
  get(userId: string, questionId: string): Promise<QuestionDetail>
  list(userId: string, conversationId: string): Promise<HistoryResponse>
  recordFeedback(userId: string, questionId: string, request: FeedbackRequest): Promise<void>
  quota(userId: string): Promise<QuotaResponse>
}

export function toDetail(record: QuestionRecord): QuestionDetail {
  return {
    id: record.id,
    conversationId: record.conversationId,
    question: record.questionRedacted,
    locale: record.locale,
    families: [...record.families],
    referenceDate: record.referenceDate,
    referenceSource: record.referenceSource,
    status: record.status,
    answer: record.answer,
    refusal: record.refusal,
    createdAt: record.createdAt.toISOString(),
  }
}

function notFound(): ApplicationError {
  return new ApplicationError({ code: ErrorCode.NotFound, detail: 'Question not found' })
}

export function createQuestionHistory(deps: {
  readonly questions: QuestionRepository
  readonly clock: Clock
  readonly caps: UsageCaps
}): QuestionHistory {
  return {
    async get(userId, questionId) {
      const record = await deps.questions.get(questionId, userId)
      if (record === null) {
        throw notFound()
      }
      return toDetail(record)
    },
    async list(userId, conversationId) {
      const records = await deps.questions.listByConversation(
        userId,
        conversationId,
        HISTORY_PAGE_SIZE,
      )
      return { items: records.map(toDetail) }
    },
    async recordFeedback(userId, questionId, request) {
      const saved = await deps.questions.recordFeedback(
        questionId,
        userId,
        request.rating,
        request.reason ?? null,
      )
      if (!saved) {
        throw notFound()
      }
    },
    async quota(userId) {
      const { day, resetAt } = quotaDay(deps.clock)
      const usage = await deps.questions.usage(day, userId)
      return {
        day,
        user: { used: usage.userRequests, limit: deps.caps.questionsPerUser },
        global: { used: usage.globalRequests, limit: deps.caps.questionsGlobal },
        resetAt,
      }
    },
  }
}
