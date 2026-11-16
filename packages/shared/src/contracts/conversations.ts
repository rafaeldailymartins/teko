import { z } from 'zod'
import { isoDateSchema } from '../vigencia/schemas.ts'
import { idSchema } from './common.ts'

/**
 * Lista das conversas do usuário (`GET /api/v1/conversations`), da mais recente para a mais
 * antiga, em páginas por cursor. Cada conversa leva o título derivado da primeira pergunta (já
 * redigida), a contagem de perguntas, o instante da última e a data de referência dela. As
 * perguntas de uma conversa continuam em `GET /api/v1/questions?conversationId=`, e
 * `DELETE /api/v1/conversations/:id` exclui uma conversa inteira.
 */

/** Conversas por página. */
export const CONVERSATIONS_PAGE_SIZE = 20
/** Tamanho máximo do título (a primeira pergunta, cortada na palavra). */
export const CONVERSATION_TITLE_MAX_LENGTH = 80

/** Cursor opaco devolvido em `nextCursor`; o cliente só o repete. */
const conversationCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/)
  .max(200)
  .meta({ description: 'Cursor opaco da próxima página (`nextCursor` da anterior)' })

export const conversationListQuerySchema = z
  .strictObject({ cursor: conversationCursorSchema.optional() })
  .meta({ description: 'Página da lista de conversas; sem cursor, a primeira' })
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>

/** Caminho de `DELETE /api/v1/conversations/:id`. */
export const conversationIdParamsSchema = z.strictObject({ id: idSchema })
export type ConversationIdParams = z.infer<typeof conversationIdParamsSchema>

export const conversationSummarySchema = z.object({
  conversationId: idSchema,
  /** Primeira pergunta da conversa, redigida, em uma linha e com até 80 caracteres. */
  title: z.string().min(1).max(CONVERSATION_TITLE_MAX_LENGTH),
  /** Perguntas gravadas na conversa. */
  questionCount: z.int().positive(),
  /** Instante da última pergunta (ordena a lista). */
  updatedAt: z.iso.datetime({ offset: true }),
  /** Data de referência efetiva da última pergunta. */
  lastReferenceDate: isoDateSchema,
})
export type ConversationSummary = z.infer<typeof conversationSummarySchema>

export const conversationListResponseSchema = z
  .object({
    items: z.array(conversationSummarySchema),
    /** `null` na última página. */
    nextCursor: conversationCursorSchema.nullable(),
  })
  .meta({ description: 'Conversas do usuário, da mais recente para a mais antiga' })
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>
