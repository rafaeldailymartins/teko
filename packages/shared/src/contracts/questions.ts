import { z } from 'zod'
import { localeSchema } from '../i18n/locales.ts'
import { isoDateSchema, periodoApuracaoSchema, referenceSourceSchema } from '../vigencia/schemas.ts'
import { citationSchema } from './citations.ts'
import {
  familyCoverageSchema,
  familySchema,
  idSchema,
  llmProviderSchema,
  refusalReasonSchema,
  retrievalModeSchema,
} from './common.ts'

/** Limite do texto da pergunta (mesmo valor no prompt e na UI). */
export const QUESTION_MAX_LENGTH = 1000

// ---------------------------------------------------------------------------------------------
// POST /api/v1/questions

/**
 * Corpo de `POST /api/v1/questions`. O cliente envia sempre exatamente uma de
 * `periodoApuracao` / `referenceDate`, e `source: 'default'` enquanto o usuário não mexe no chip.
 */
export const askQuestionRequestSchema = z
  .strictObject({
    /** ID da conversa (o `chatId` do `useChat`), para agrupar o histórico. */
    conversationId: idSchema,
    question: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
    locale: localeSchema,
    /** Famílias pedidas; ausente = todas as famílias do corpus. */
    families: z.array(familySchema).min(1).max(10).optional(),
    periodoApuracao: periodoApuracaoSchema.optional(),
    referenceDate: isoDateSchema.optional(),
    source: referenceSourceSchema,
  })
  .refine((body) => (body.periodoApuracao === undefined) !== (body.referenceDate === undefined), {
    message: 'Informe exatamente um entre periodoApuracao e referenceDate',
    path: ['referenceDate'],
  })
  .meta({ description: 'Pergunta sobre a legislação numa data de referência' })

export type AskQuestionRequest = z.infer<typeof askQuestionRequestSchema>

/**
 * Data de referência resolvida. É o payload do chunk `data-reference-date` e o `resolved` das
 * respostas. `alternatives` lista outras datas plausíveis (ex.: a data citada no texto).
 */
export const resolvedReferenceDateSchema = z.object({
  value: isoDateSchema,
  source: referenceSourceSchema,
  periodBoundaryInside: z.boolean(),
  alternatives: z.array(isoDateSchema),
})
export type ResolvedReferenceDate = z.infer<typeof resolvedReferenceDateSchema>

/** Metadados da resposta: payload do chunk `data-meta`. */
export const answerMetaSchema = z.object({
  corpusVersion: z.int().nonnegative(),
  retrievalMode: retrievalModeSchema,
  /** Famílias pedidas sem cobertura na data (cobertura parcial). */
  uncoveredFamilies: z.array(familySchema),
  provider: llmProviderSchema,
  /** Modelo que falhou antes do primeiro token, quando houve fallback. */
  fallbackFrom: z.string().min(1).nullable(),
  cached: z.boolean(),
})
export type AnswerMeta = z.infer<typeof answerMetaSchema>

/** Recusa: payload do chunk `data-refusal` e da resposta `refused`. */
export const refusalSchema = z.object({
  reason: refusalReasonSchema,
  /** Em `out_of_coverage`: intervalos cobertos de cada família, para sugerir datas. */
  coverage: z.array(familyCoverageSchema).optional(),
})
export type Refusal = z.infer<typeof refusalSchema>

/** Resposta completa (cache hit ou leitura do histórico). */
export const answerSchema = z.object({
  /** Markdown saneado; citações aparecem como links `cite:S1`. */
  markdown: z.string(),
  citations: z.array(citationSchema),
  meta: answerMetaSchema,
})
export type Answer = z.infer<typeof answerSchema>

export const ClarificationReason = {
  /** A data do texto conflita com a escolha explícita do usuário. */
  ExplicitConflict: 'explicit_conflict',
  /** O texto traz datas conflitantes entre si. */
  AmbiguousText: 'ambiguous_text',
} as const
export type ClarificationReason = (typeof ClarificationReason)[keyof typeof ClarificationReason]

export const QuestionStatus = {
  Answered: 'answered',
  Refused: 'refused',
  NeedsClarification: 'needs_clarification',
  Accepted: 'accepted',
} as const
export type QuestionStatus = (typeof QuestionStatus)[keyof typeof QuestionStatus]

export const askQuestionResponseSchema = z
  .discriminatedUnion('status', [
    z.object({
      status: z.literal(QuestionStatus.Answered),
      questionId: idSchema,
      resolved: resolvedReferenceDateSchema,
      answer: answerSchema,
    }),
    z.object({
      status: z.literal(QuestionStatus.Refused),
      questionId: idSchema,
      resolved: resolvedReferenceDateSchema,
      refusal: refusalSchema,
    }),
    z.object({
      status: z.literal(QuestionStatus.NeedsClarification),
      reason: z.enum(ClarificationReason),
      /** Datas entre as quais o usuário escolhe; a escolha volta com `source: 'clarified'`. */
      candidates: z.array(isoDateSchema).min(2),
    }),
    /**
     * A resposta sai em `POST /api/v1/questions/:id/stream`, na mesma origem (ADR 0029): o cookie
     * de sessão autentica e a API confere o `Origin`; o claim `pending → streaming` garante um
     * stream só por pergunta. Sem ticket, sem URL absoluta e sem CORS.
     */
    z.object({
      status: z.literal(QuestionStatus.Accepted),
      questionId: idSchema,
      resolved: resolvedReferenceDateSchema,
    }),
  ])
  .meta({ description: 'Resultado de POST /api/v1/questions' })

export type AskQuestionResponse = z.infer<typeof askQuestionResponseSchema>

// ---------------------------------------------------------------------------------------------
// POST /api/v1/questions/:id/stream e /feedback

export const questionIdParamsSchema = z.strictObject({ id: idSchema })
export type QuestionIdParams = z.infer<typeof questionIdParamsSchema>

export const FeedbackRating = {
  Up: 'up',
  Down: 'down',
} as const
export type FeedbackRating = (typeof FeedbackRating)[keyof typeof FeedbackRating]

export const FeedbackReason = {
  WrongCitation: 'wrong_citation',
  Incorrect: 'incorrect',
  Outdated: 'outdated',
  Incomplete: 'incomplete',
  Other: 'other',
} as const
export type FeedbackReason = (typeof FeedbackReason)[keyof typeof FeedbackReason]

/** Polegar e motivo. Sem texto livre: nada de PII no feedback. */
export const feedbackRequestSchema = z.strictObject({
  rating: z.enum(FeedbackRating),
  reason: z.enum(FeedbackReason).optional(),
})
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>
