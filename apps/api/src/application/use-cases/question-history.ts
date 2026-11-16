import {
  CONVERSATION_TITLE_MAX_LENGTH,
  CONVERSATIONS_PAGE_SIZE,
  type ConversationListResponse,
  type ConversationSummary,
  type FeedbackRequest,
  HISTORY_PAGE_SIZE,
  type HistoryResponse,
  idSchema,
  type QuestionDetail,
  type QuotaResponse,
} from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type { Clock } from '../ports/clock.ts'
import type {
  ConversationCursor,
  ConversationRecord,
  QuestionRecord,
  QuestionRepository,
  UsageCaps,
} from '../ports/question-repository.ts'
import { quotaDay } from './ask-question.ts'

/**
 * Leituras, o feedback e a exclusão das conversas do usuário: detalhe (`GET /questions/:id`, que
 * também serve para reler uma resposta depois de uma desconexão), histórico da conversa, lista de
 * conversas, polegar com motivo, exclusão de uma conversa e a cota do dia. Cada operação filtra
 * pelo dono: pergunta ou conversa de outro usuário é 404, e a lista só traz as conversas do próprio
 * usuário.
 */
export interface QuestionHistory {
  get(userId: string, questionId: string): Promise<QuestionDetail>
  list(userId: string, conversationId: string): Promise<HistoryResponse>
  /** Uma página da lista de conversas (`GET /conversations`); cursor inválido é 400. */
  conversations(userId: string, cursor?: string): Promise<ConversationListResponse>
  recordFeedback(userId: string, questionId: string, request: FeedbackRequest): Promise<void>
  /**
   * Exclui uma conversa do usuário com as perguntas, respostas, citações e feedback dela
   * (`DELETE /conversations/:id`). Conversa inexistente ou de outro usuário é 404, com o mesmo
   * problem; com uma resposta ainda em stream, 409 `stream_busy` (o cliente tenta de novo quando o
   * stream acaba). A cota do dia não muda.
   */
  deleteConversation(userId: string, conversationId: string): Promise<void>
  quota(userId: string): Promise<QuotaResponse>
}

/** Instante UTC com microssegundos, como o adapter o devolve (`to_char(… 'US')`). */
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const ELLIPSIS = '…'

/** Cursor opaco: `instante|conversa` em base64url. */
export function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(`${cursor.lastAskedAt}|${cursor.conversationId}`).toString('base64url')
}

/** O inverso de `encodeConversationCursor`; `null` para qualquer coisa que ele não produziria. */
export function decodeConversationCursor(value: string): ConversationCursor | null {
  const [lastAskedAt = '', conversationId = '', ...rest] = Buffer.from(value, 'base64url')
    .toString('utf8')
    .split('|')
  if (rest.length > 0 || !CURSOR_INSTANT.test(lastAskedAt)) {
    return null
  }
  return idSchema.safeParse(conversationId).success ? { lastAskedAt, conversationId } : null
}

/**
 * Título da conversa: a primeira pergunta em uma linha, cortada na última palavra inteira que cabe
 * em 80 caracteres (com reticências). Uma palavra única maior que o limite é cortada no meio.
 */
export function conversationTitle(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim()
  if (text.length <= CONVERSATION_TITLE_MAX_LENGTH) {
    return text === '' ? ELLIPSIS : text
  }
  const room = text.slice(0, CONVERSATION_TITLE_MAX_LENGTH - ELLIPSIS.length)
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace > room.length / 2 ? room.slice(0, lastSpace) : room
  return `${cut.trimEnd()}${ELLIPSIS}`
}

function toSummary(record: ConversationRecord): ConversationSummary {
  return {
    conversationId: record.conversationId,
    title: conversationTitle(record.firstQuestion),
    questionCount: record.questionCount,
    updatedAt: new Date(record.lastAskedAt).toISOString(),
    lastReferenceDate: record.lastReferenceDate,
  }
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
    async conversations(userId, cursor) {
      const after = cursor === undefined ? null : decodeConversationCursor(cursor)
      if (cursor !== undefined && after === null) {
        throw new ApplicationError({ code: ErrorCode.ValidationError, detail: 'Invalid cursor' })
      }
      // Um a mais que a página: se vier, há uma próxima.
      const records = await deps.questions.listConversations(
        userId,
        after,
        CONVERSATIONS_PAGE_SIZE + 1,
      )
      const page = records.slice(0, CONVERSATIONS_PAGE_SIZE)
      const last = page.at(-1)
      return {
        items: page.map(toSummary),
        nextCursor:
          records.length > CONVERSATIONS_PAGE_SIZE && last !== undefined
            ? encodeConversationCursor(last)
            : null,
      }
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
    async deleteConversation(userId, conversationId) {
      const outcome = await deps.questions.deleteConversation(userId, conversationId)
      if (outcome.kind === 'not_found') {
        throw new ApplicationError({ code: ErrorCode.NotFound, detail: 'Conversation not found' })
      }
      if (outcome.kind === 'busy') {
        throw new ApplicationError({
          code: ErrorCode.StreamBusy,
          detail: 'An answer in this conversation is still streaming',
        })
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
