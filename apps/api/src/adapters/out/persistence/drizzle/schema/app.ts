import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  snakeCase,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.ts'

/**
 * Schema `app`: estado da aplicação (perguntas, feedback, cache, uso e rate limit). O runtime
 * (`teko_app`) lê e escreve. As rotas que o usam chegam na F4; o schema já nasce canônico para que
 * os grants e o `ALTER DEFAULT PRIVILEGES` valham desde a primeira migração.
 *
 * `user_id` referencia `auth.user` (Better Auth) com `ON DELETE CASCADE`: apagar o usuário
 * (`DELETE /me`) apaga perguntas e feedback.
 */
export const app = snakeCase.schema('app')

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const questions = app.table(
  'questions',
  {
    id: uuid().primaryKey().default(sql`uuidv7()`),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    conversationId: uuid().notNull(),
    questionRedacted: text().notNull(),
    locale: text().notNull(),
    families: text().array().notNull(),
    referenceDate: date({ mode: 'string' }).notNull(),
    referenceSource: text().notNull(),
    status: text().notNull().default('pending'),
    refusalReason: text(),
    answerMd: text(),
    citations: jsonb(),
    retrieval: jsonb(),
    retrievalMode: text(),
    provider: text(),
    model: text(),
    promptVersion: text(),
    corpusVersion: integer(),
    cacheKey: text(),
    tokensIn: integer(),
    tokensOut: integer(),
    /** Custo sombra (gravado em 100% das consultas; cache hit grava 0). */
    shadowCostUsd: numeric({ precision: 10, scale: 6 }).notNull().default('0'),
    ttftMs: integer(),
    latencyMs: integer(),
    langfuseTraceId: text(),
    streamStartedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    check(
      'questions_status',
      sql`${t.status} IN ('pending', 'streaming', 'answered', 'refused', 'failed', 'aborted', 'expired')`,
    ),
    check(
      'questions_refusal_reason',
      sql`${t.refusalReason} IS NULL OR ${t.refusalReason} IN ('out_of_coverage', 'no_evidence', 'model_insufficient', 'citation_invalid')`,
    ),
    index('questions_user_created').on(t.userId, t.createdAt.desc()),
    index('questions_conversation').on(t.conversationId),
    index('questions_cache_key').on(t.cacheKey),
  ],
)

export const feedback = app.table(
  'feedback',
  {
    questionId: uuid()
      .primaryKey()
      .references(() => questions.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rating: text().notNull(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [check('feedback_rating', sql`${t.rating} IN ('up', 'down')`)],
)

export const answerCache = app.table(
  'answer_cache',
  {
    cacheKey: text().primaryKey(),
    answer: jsonb().notNull(),
    corpusVersion: integer().notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [index('answer_cache_expires').on(t.expiresAt)],
)

export const usageDaily = app.table(
  'usage_daily',
  {
    day: date({ mode: 'string' }).notNull(),
    /** `global`, `user:<id>` ou `env:<APP_ENV>`. */
    scope: text().notNull(),
    requests: integer().notNull().default(0),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    neurons: integer().notNull().default(0),
    langfuseUnits: integer().notNull().default(0),
    streamSeconds: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.scope] })],
)

/** Janelas do rate limit das rotas proxiadas; as vencidas saem na manutenção semanal. */
export const rateLimits = app.table(
  'rate_limits',
  {
    key: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limits_expires').on(t.expiresAt),
  ],
)
