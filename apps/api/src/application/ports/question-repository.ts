import type {
  Answer,
  AnswerMeta,
  Citation,
  FeedbackRating,
  FeedbackReason,
  Refusal,
  RetrievalMode,
  StoredQuestionStatus,
} from '@teko/shared/contracts'
import type { QuotaScope } from '@teko/shared/errors'
import type { Locale } from '@teko/shared/i18n'
import type { IsoDate, PeriodoApuracao, ReferenceSource } from '@teko/shared/vigencia'

/**
 * Persistência de `app.questions`, `app.usage_daily`, `app.answer_cache` e `app.feedback` (role
 * `teko_app`), sempre em transações curtas. A reserva da pergunta, o claim do stream e a exclusão
 * de uma conversa são atômicos.
 */

/** Data pedida pelo cliente, gravada para o stream refazer a mesma resolução. */
export type StoredReferenceInput =
  | { readonly referenceDate: IsoDate; readonly periodoApuracao?: undefined }
  | { readonly periodoApuracao: PeriodoApuracao; readonly referenceDate?: undefined }

export interface NewQuestion {
  readonly userId: string
  readonly conversationId: string
  readonly questionRedacted: string
  readonly locale: Locale
  readonly families: readonly string[]
  readonly referenceDate: IsoDate
  readonly referenceSource: ReferenceSource
  readonly referenceInput: StoredReferenceInput
  readonly requestId: string
  readonly zeroDataRetention: boolean
  readonly cacheKey: string | null
  readonly corpusVersion: number | null
}

/** Pergunta encerrada já no `POST` (recusa sem LLM ou acerto do cache). */
interface FinishedQuestion extends NewQuestion {
  readonly status: typeof StoredQuestionStatus.Answered | typeof StoredQuestionStatus.Refused
  readonly answer: Answer | null
  readonly refusal: Refusal | null
}

export interface UsageCaps {
  readonly questionsGlobal: number
  readonly questionsPerUser: number
  readonly streamSecondsGlobal: number
  readonly neuronsGlobal: number
}

/** O que a pergunta reserva antes do stream (devolvido no fim pelo uso real). */
export interface UsageReservation {
  readonly streamSeconds: number
  readonly neurons: number
}

export interface UsageSnapshot {
  readonly globalRequests: number
  readonly userRequests: number
  readonly globalStreamSeconds: number
  readonly globalNeurons: number
  /** O usuário tem um stream em andamento (claim há menos de 110 s). */
  readonly activeStream: boolean
}

export type AcceptDecision =
  | { readonly kind: 'ok' }
  | { readonly kind: 'quota'; readonly scope: QuotaScope }
  | { readonly kind: 'busy' }

type AcceptOutcome =
  | { readonly kind: 'accepted'; readonly questionId: string }
  | Exclude<AcceptDecision, { readonly kind: 'ok' }>

export interface ClaimedQuestion extends NewQuestion {
  readonly id: string
}

export type ClaimOutcome =
  | { readonly kind: 'claimed'; readonly question: ClaimedQuestion }
  | { readonly kind: 'busy' }
  | { readonly kind: 'not_found' }

export interface StreamResult {
  readonly status:
    | typeof StoredQuestionStatus.Answered
    | typeof StoredQuestionStatus.Refused
    | typeof StoredQuestionStatus.Failed
    | typeof StoredQuestionStatus.Aborted
  readonly answerMarkdown: string | null
  readonly citations: readonly Citation[]
  /** `meta` da resposta (provedor, modo da busca, cobertura parcial), para o histórico. */
  readonly meta: AnswerMeta | null
  readonly refusal: Refusal | null
  readonly retrievalMode: RetrievalMode | null
  readonly provider: string | null
  readonly model: string | null
  readonly promptVersion: string
  readonly corpusVersion: number | null
  readonly inputTokens: number
  readonly outputTokens: number
  readonly shadowCostUsd: number
  readonly ttftMs: number | null
  readonly latencyMs: number
  /** Segundos de stream de fato usados (acertam a reserva). */
  readonly streamSeconds: number
  /** Resposta a guardar no cache exato (só respostas com citação válida). */
  readonly cache: { readonly key: string; readonly answer: Answer; readonly expiresAt: Date } | null
  /** `trace_id` do trace `rag-query` no Langfuse; `null` quando a pergunta não foi amostrada. */
  readonly langfuseTraceId: string | null
  /** Units do Langfuse do trace (somadas em `usage_daily.langfuse_units`, linha `global`). */
  readonly langfuseUnits: number
}

/** O feedback gravado e o trace do Langfuse da pergunta, se ela foi amostrada. */
export interface SavedFeedback {
  readonly langfuseTraceId: string | null
}

export interface QuestionRecord extends NewQuestion {
  readonly id: string
  readonly status: StoredQuestionStatus
  readonly answer: Answer | null
  readonly refusal: Refusal | null
  readonly createdAt: Date
}

/**
 * Posição na lista de conversas: a última pergunta da conversa anterior e o id dela. O instante vai
 * como texto UTC com microssegundos (`2026-11-10T15:00:00.123456Z`), a precisão do Postgres: um
 * `Date` perderia os microssegundos e a página seguinte repetiria ou pularia conversas.
 */
export interface ConversationCursor {
  readonly lastAskedAt: string
  readonly conversationId: string
}

/** Uma conversa agregada a partir das perguntas dela. */
export interface ConversationRecord {
  readonly conversationId: string
  /** Primeira pergunta (redigida), de onde sai o título. */
  readonly firstQuestion: string
  readonly questionCount: number
  /** Instante da última pergunta, com a precisão do banco (é o cursor). */
  readonly lastAskedAt: string
  readonly lastReferenceDate: IsoDate
}

/**
 * Resultado da exclusão de uma conversa: `not_found` quando o usuário não tem pergunta nela (a
 * conversa não existe ou é de outro), `busy` quando uma resposta dela ainda está em stream.
 */
export type DeleteConversationOutcome =
  | { readonly kind: 'deleted'; readonly questions: number }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'busy' }

export interface QuestionRepository {
  insertFinished(question: FinishedQuestion): Promise<string>
  /**
   * Na mesma transação, sob `pg_advisory_xact_lock` do usuário: lê o uso do dia, pede a decisão
   * do `QuotaGuard` e, se aceita, soma a requisição e a reserva e grava a pergunta `pending`.
   */
  accept(
    question: NewQuestion,
    day: IsoDate,
    reservation: UsageReservation,
    decide: (usage: UsageSnapshot) => AcceptDecision,
  ): Promise<AcceptOutcome>
  /** `pending → streaming` atômico (só o dono, só uma vez). */
  claim(questionId: string, userId: string): Promise<ClaimOutcome>
  /**
   * Grava o resultado, acerta o uso reservado (no dia em que a pergunta foi aceita, em São Paulo) e
   * guarda o cache, numa transação.
   */
  finish(questionId: string, reservation: UsageReservation, result: StreamResult): Promise<void>
  get(questionId: string, userId: string): Promise<QuestionRecord | null>
  listByConversation(
    userId: string,
    conversationId: string,
    limit: number,
  ): Promise<QuestionRecord[]>
  /**
   * Conversas do usuário, da última pergunta mais recente para a mais antiga (empate pelo id da
   * conversa, decrescente), começando depois de `after`.
   */
  listConversations(
    userId: string,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationRecord[]>
  /**
   * `null` quando a pergunta não existe para o usuário. Se a pergunta tem trace no Langfuse, a
   * mesma instrução soma 1 unit (o score `user_feedback`) em `usage_daily.langfuse_units`.
   */
  recordFeedback(
    questionId: string,
    userId: string,
    rating: FeedbackRating,
    reason: FeedbackReason | null,
  ): Promise<SavedFeedback | null>
  /**
   * Grava o `trace_id` do Langfuse de uma pergunta encerrada no `POST` (cache ou fora da
   * cobertura) e soma as units do trace no dia dela (linha `global` de `usage_daily`).
   */
  recordTrace(questionId: string, traceId: string, units: number): Promise<void>
  /** Units do Langfuse gravadas desde o dia dado (linha `global` de `usage_daily`). */
  langfuseUnitsSince(day: IsoDate): Promise<number>
  /**
   * Numa transação, trava as perguntas do usuário na conversa (`FOR UPDATE`) e, se nenhuma estiver
   * em stream ativo, apaga todas; o feedback sai pelo `ON DELETE CASCADE`. O uso do dia
   * (`usage_daily`) e o cache de respostas não mudam.
   */
  deleteConversation(userId: string, conversationId: string): Promise<DeleteConversationOutcome>
  usage(day: IsoDate, userId: string): Promise<UsageSnapshot>
  cachedAnswer(cacheKey: string, now: Date): Promise<Answer | null>
}
