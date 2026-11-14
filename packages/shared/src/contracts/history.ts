import { z } from 'zod'
import { localeSchema } from '../i18n/locales.ts'
import { isoDateSchema, referenceSourceSchema } from '../vigencia/schemas.ts'
import { familySchema, idSchema } from './common.ts'
import { answerSchema, refusalSchema } from './questions.ts'

/**
 * Histórico (`GET /api/v1/questions?conversationId=`), detalhe de uma pergunta
 * (`GET /api/v1/questions/:id`, também usado para reler uma resposta depois de uma desconexão,
 * já que o stream não tem resume) e cota do dia (`GET /api/v1/me/quota`).
 */

/** Estado gravado da pergunta (`app.questions.status`). */
export const StoredQuestionStatus = {
  Pending: 'pending',
  Streaming: 'streaming',
  Answered: 'answered',
  Refused: 'refused',
  Failed: 'failed',
  Aborted: 'aborted',
  Expired: 'expired',
} as const
export type StoredQuestionStatus = (typeof StoredQuestionStatus)[keyof typeof StoredQuestionStatus]

export const questionDetailSchema = z
  .object({
    id: idSchema,
    conversationId: idSchema,
    /** Pergunta já redigida (PII trocada por marcadores). */
    question: z.string(),
    locale: localeSchema,
    families: z.array(familySchema),
    referenceDate: isoDateSchema,
    referenceSource: referenceSourceSchema,
    status: z.enum(StoredQuestionStatus),
    answer: answerSchema.nullable(),
    refusal: refusalSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ description: 'Pergunta do histórico, com a resposta ou a recusa' })
export type QuestionDetail = z.infer<typeof questionDetailSchema>

export const HISTORY_PAGE_SIZE = 50

export const historyQuerySchema = z
  .strictObject({ conversationId: idSchema })
  .meta({ description: 'Conversa cujo histórico é listado' })
export type HistoryQuery = z.infer<typeof historyQuerySchema>

export const historyResponseSchema = z
  .object({ items: z.array(questionDetailSchema) })
  .meta({ description: 'Perguntas da conversa, da mais antiga para a mais recente' })
export type HistoryResponse = z.infer<typeof historyResponseSchema>

const quotaCounterSchema = z.object({
  used: z.int().nonnegative(),
  limit: z.int().nonnegative(),
})

export const quotaResponseSchema = z
  .object({
    /** Dia corrente em America/Sao_Paulo. */
    day: isoDateSchema,
    /** Perguntas do usuário hoje. */
    user: quotaCounterSchema,
    /** Perguntas de todos os usuários hoje (teto do ambiente). */
    global: quotaCounterSchema,
    /** Quando as cotas voltam (meia-noite em São Paulo). */
    resetAt: z.iso.datetime({ offset: true }),
  })
  .meta({ description: 'Cota de perguntas do dia' })
export type QuotaResponse = z.infer<typeof quotaResponseSchema>
