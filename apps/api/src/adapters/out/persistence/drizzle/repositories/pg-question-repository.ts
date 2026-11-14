import {
  type Answer,
  answerSchema,
  type Refusal,
  refusalSchema,
  type StoredQuestionStatus,
} from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import type { ReferenceSource } from '@teko/shared/vigencia'
import type pg from 'pg'
import type {
  ClaimedQuestion,
  NewQuestion,
  QuestionRecord,
  QuestionRepository,
  StoredReferenceInput,
  UsageSnapshot,
} from '#app/ports/question-repository.ts'
import { isTransientConnectionError, retryTransientRead } from '../client.ts'

/**
 * `QuestionRepository` sobre o `pg` (`teko_app`, pooler do Neon em modo transação: sem prepared
 * statements nomeados nem `SET` de sessão). As transações são curtas e nunca seguram a conexão
 * durante o LLM.
 *
 * - A reserva toma o advisory lock do usuário e depois o global: duas abas do mesmo usuário não
 *   passam juntas pelo `QuotaGuard`, e duas pessoas não estouram o teto global ao mesmo tempo.
 * - `retrieval` (jsonb) guarda a entrada da data, a política regional, o `meta` e a recusa: o que o
 *   stream e o histórico precisam para refazer a resposta.
 */

export const QUESTION_COLUMNS = `id, user_id, conversation_id, question_redacted, locale, families,
  reference_date::text AS reference_date, reference_source, status, answer_md, citations,
  retrieval, cache_key, corpus_version, request_id, created_at`

export interface QuestionRow {
  readonly id: string
  readonly user_id: string
  readonly conversation_id: string
  readonly question_redacted: string
  readonly locale: Locale
  readonly families: string[]
  readonly reference_date: string
  readonly reference_source: ReferenceSource
  readonly status: StoredQuestionStatus
  readonly answer_md: string | null
  readonly citations: unknown
  readonly retrieval: StoredRetrieval | null
  readonly cache_key: string | null
  readonly corpus_version: number | null
  readonly request_id: string | null
  readonly created_at: Date
}

interface StoredRetrieval {
  readonly input?: StoredReferenceInput
  readonly zdr?: boolean
  readonly meta?: unknown
  readonly refusal?: unknown
}

const LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtextextended('teko-quota:' || $1, 0)),
  pg_advisory_xact_lock(hashtextextended('teko-quota:global', 0))`

const USAGE_SQL = `SELECT
  coalesce(sum(requests) FILTER (WHERE scope = 'global'), 0)::int AS global_requests,
  coalesce(sum(requests) FILTER (WHERE scope = 'user:' || $2), 0)::int AS user_requests,
  coalesce(sum(stream_seconds) FILTER (WHERE scope = 'global'), 0)::int AS global_stream_seconds,
  coalesce(sum(neurons) FILTER (WHERE scope = 'global'), 0)::int AS global_neurons,
  EXISTS (SELECT 1 FROM app.questions WHERE user_id = $2::uuid AND status = 'streaming'
          AND stream_started_at > now() - interval '110 seconds') AS active_stream
FROM app.usage_daily WHERE day = $1::date AND scope IN ('global', 'user:' || $2)`

interface UsageRow {
  readonly global_requests: number
  readonly user_requests: number
  readonly global_stream_seconds: number
  readonly global_neurons: number
  readonly active_stream: boolean
}

const RESERVE_SQL = `INSERT INTO app.usage_daily AS u (day, scope, requests, stream_seconds, neurons)
VALUES ($1::date, 'global', 1, $3, $4), ($1::date, 'user:' || $2, 1, $3, $4)
ON CONFLICT (day, scope) DO UPDATE SET requests = u.requests + 1,
  stream_seconds = u.stream_seconds + EXCLUDED.stream_seconds, neurons = u.neurons + EXCLUDED.neurons`

const INSERT_SQL = `INSERT INTO app.questions (user_id, conversation_id, question_redacted, locale,
  families, reference_date, reference_source, status, refusal_reason, answer_md, citations,
  retrieval, cache_key, corpus_version, prompt_version, request_id, retrieval_mode, provider, model)
VALUES ($1, $2, $3, $4, $5::text[], $6::date, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14,
  $15, $16, $17, $18, $19)
RETURNING id`

const CLAIM_SQL = `UPDATE app.questions SET status = 'streaming', stream_started_at = now(),
  updated_at = now()
WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'pending'
RETURNING ${QUESTION_COLUMNS}`

const FINISH_SQL = `UPDATE app.questions SET status = $2, refusal_reason = $3, answer_md = $4,
  citations = $5::jsonb, retrieval = coalesce(retrieval, '{}'::jsonb) || $6::jsonb,
  retrieval_mode = $7, provider = $8, model = $9, prompt_version = $10,
  corpus_version = coalesce($11, corpus_version), tokens_in = $12, tokens_out = $13,
  shadow_cost_usd = $14, ttft_ms = $15, latency_ms = $16, updated_at = now()
WHERE id = $1::uuid AND status = 'streaming'
RETURNING user_id, (created_at AT TIME ZONE 'America/Sao_Paulo')::date::text AS day`

const SETTLE_SQL = `UPDATE app.usage_daily SET
  stream_seconds = greatest(0, stream_seconds - $3 + $4),
  tokens_in = tokens_in + $5, tokens_out = tokens_out + $6
WHERE day = $1::date AND scope IN ('global', 'user:' || $2)`

const CACHE_SQL = `INSERT INTO app.answer_cache (cache_key, answer, corpus_version, expires_at)
VALUES ($1, $2::jsonb, $3, $4)
ON CONFLICT (cache_key) DO UPDATE SET answer = EXCLUDED.answer,
  corpus_version = EXCLUDED.corpus_version, expires_at = EXCLUDED.expires_at, created_at = now()`

const FEEDBACK_SQL = `INSERT INTO app.feedback (question_id, user_id, rating, reason)
SELECT q.id, q.user_id, $3, $4 FROM app.questions q WHERE q.id = $1::uuid AND q.user_id = $2::uuid
ON CONFLICT (question_id) DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason,
  created_at = now()
RETURNING question_id`

function parseOrNull<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
): T | null {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = schema.safeParse(value)
  return parsed.success ? (parsed.data as T) : null
}

function referenceInputOf(row: QuestionRow): StoredReferenceInput {
  return row.retrieval?.input ?? { referenceDate: row.reference_date }
}

function toNewQuestion(row: QuestionRow): NewQuestion {
  return {
    userId: row.user_id,
    conversationId: row.conversation_id,
    questionRedacted: row.question_redacted,
    locale: row.locale,
    families: row.families,
    referenceDate: row.reference_date,
    referenceSource: row.reference_source,
    referenceInput: referenceInputOf(row),
    requestId: row.request_id ?? '',
    zeroDataRetention: row.retrieval?.zdr === true,
    cacheKey: row.cache_key,
    corpusVersion: row.corpus_version,
  }
}

export function toRecord(row: QuestionRow): QuestionRecord {
  const answer =
    row.status === 'answered' && row.answer_md !== null
      ? parseOrNull<Answer>(answerSchema, {
          markdown: row.answer_md,
          citations: row.citations,
          meta: row.retrieval?.meta,
        })
      : null
  return {
    ...toNewQuestion(row),
    id: row.id,
    status: row.status,
    answer,
    refusal: parseOrNull<Refusal>(refusalSchema, row.retrieval?.refusal),
    createdAt: row.created_at,
  }
}

function insertParameters(
  question: NewQuestion,
  status: string,
  answer: Answer | null,
  refusal: Refusal | null,
): unknown[] {
  const retrieval: StoredRetrieval = {
    input: question.referenceInput,
    zdr: question.zeroDataRetention,
    meta: answer?.meta ?? null,
    refusal,
  }
  return [
    question.userId,
    question.conversationId,
    question.questionRedacted,
    question.locale,
    question.families,
    question.referenceDate,
    question.referenceSource,
    status,
    refusal?.reason ?? null,
    answer?.markdown ?? null,
    answer === null ? null : JSON.stringify(answer.citations),
    JSON.stringify(retrieval),
    question.cacheKey,
    question.corpusVersion,
    null,
    question.requestId,
    answer?.meta.retrievalMode ?? null,
    answer?.meta.provider ?? null,
    null,
  ]
}

async function inTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  let failure: unknown
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    failure = error
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release(isTransientConnectionError(failure) ? (failure as Error) : undefined)
  }
}

function usageOf(row: UsageRow | undefined): UsageSnapshot {
  return {
    globalRequests: row?.global_requests ?? 0,
    userRequests: row?.user_requests ?? 0,
    globalStreamSeconds: row?.global_stream_seconds ?? 0,
    globalNeurons: row?.global_neurons ?? 0,
    activeStream: row?.active_stream === true,
  }
}

export function createPgQuestionRepository(pool: pg.Pool): QuestionRepository {
  return {
    async insertFinished(question) {
      const { rows } = await pool.query<{ id: string }>(
        INSERT_SQL,
        insertParameters(question, question.status, question.answer, question.refusal),
      )
      return (rows[0] as { id: string }).id
    },

    accept: (question, day, reservation, decide) =>
      inTransaction(pool, async (client) => {
        await client.query(LOCK_SQL, [question.userId])
        const usage = await client.query<UsageRow>(USAGE_SQL, [day, question.userId])
        const decision = decide(usageOf(usage.rows[0]))
        if (decision.kind !== 'ok') {
          return decision
        }
        await client.query(RESERVE_SQL, [
          day,
          question.userId,
          reservation.streamSeconds,
          reservation.neurons,
        ])
        const { rows } = await client.query<{ id: string }>(
          INSERT_SQL,
          insertParameters(question, 'pending', null, null),
        )
        return { kind: 'accepted', questionId: (rows[0] as { id: string }).id }
      }),

    async claim(questionId, userId) {
      const { rows } = await pool.query<QuestionRow>(CLAIM_SQL, [questionId, userId])
      const row = rows[0]
      if (row !== undefined) {
        const question: ClaimedQuestion = { ...toNewQuestion(row), id: row.id }
        return { kind: 'claimed', question }
      }
      const exists = await pool.query(
        'SELECT 1 FROM app.questions WHERE id = $1::uuid AND user_id = $2::uuid',
        [questionId, userId],
      )
      return exists.rowCount === 0 ? { kind: 'not_found' } : { kind: 'busy' }
    },

    finish: (questionId, reservation, result) =>
      inTransaction(pool, async (client) => {
        const updated = await client.query<{ user_id: string; day: string }>(FINISH_SQL, [
          questionId,
          result.status,
          result.refusal?.reason ?? null,
          result.answerMarkdown,
          JSON.stringify(result.citations),
          JSON.stringify({ meta: result.meta, refusal: result.refusal }),
          result.retrievalMode,
          result.provider,
          result.model,
          result.promptVersion,
          result.corpusVersion,
          result.inputTokens,
          result.outputTokens,
          result.shadowCostUsd,
          result.ttftMs,
          result.latencyMs,
        ])
        const row = updated.rows[0]
        if (row === undefined) {
          return
        }
        await client.query(SETTLE_SQL, [
          row.day,
          row.user_id,
          reservation.streamSeconds,
          result.streamSeconds,
          result.inputTokens,
          result.outputTokens,
        ])
        if (result.cache !== null) {
          await client.query(CACHE_SQL, [
            result.cache.key,
            JSON.stringify(result.cache.answer),
            result.cache.answer.meta.corpusVersion,
            result.cache.expiresAt,
          ])
        }
      }),

    async get(questionId, userId) {
      const { rows } = await retryTransientRead(() =>
        pool.query<QuestionRow>(
          `SELECT ${QUESTION_COLUMNS} FROM app.questions WHERE id = $1::uuid AND user_id = $2::uuid`,
          [questionId, userId],
        ),
      )
      const row = rows[0]
      return row === undefined ? null : toRecord(row)
    },

    async listByConversation(userId, conversationId, limit) {
      const { rows } = await retryTransientRead(() =>
        pool.query<QuestionRow>(
          `SELECT ${QUESTION_COLUMNS} FROM app.questions
           WHERE user_id = $1::uuid AND conversation_id = $2::uuid
           ORDER BY created_at, id LIMIT $3`,
          [userId, conversationId, limit],
        ),
      )
      return rows.map(toRecord)
    },

    async recordFeedback(questionId, userId, rating, reason) {
      const { rowCount } = await pool.query(FEEDBACK_SQL, [questionId, userId, rating, reason])
      return rowCount === 1
    },

    async usage(day, userId) {
      const { rows } = await retryTransientRead(() =>
        pool.query<UsageRow>(USAGE_SQL, [day, userId]),
      )
      return usageOf(rows[0])
    },

    async cachedAnswer(cacheKey, now) {
      const { rows } = await retryTransientRead(() =>
        pool.query<{ answer: unknown }>(
          'SELECT answer FROM app.answer_cache WHERE cache_key = $1 AND expires_at > $2',
          [cacheKey, now],
        ),
      )
      return parseOrNull<Answer>(answerSchema, rows[0]?.answer)
    },
  }
}
