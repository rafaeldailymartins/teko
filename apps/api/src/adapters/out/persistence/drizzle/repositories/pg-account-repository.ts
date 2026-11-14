import type pg from 'pg'
import type { AccountRepository, MaintenanceRepository } from '#app/ports/account-repository.ts'
import { toDetail } from '#app/use-cases/question-history.ts'
import { isTransientConnectionError } from '../client.ts'
import { QUESTION_COLUMNS, type QuestionRow, toRecord } from './pg-question-repository.ts'

/**
 * Exportação, exclusão e expurgo dos dados de usuário (`teko_app`). A exclusão é uma transação: o
 * `DELETE` em `auth.user` leva, por cascata, sessões, contas OAuth, passkeys, perguntas e feedback;
 * as linhas de uso (`usage_daily`, escopo `user:<id>`) e as janelas de rate limit da chave do
 * usuário saem junto.
 */

interface UserRow {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly image: string | null
  readonly created_at: Date
  readonly is_adult: boolean
  readonly terms_version: string | null
  readonly terms_accepted_at: Date | null
  readonly country_of_residence: string | null
}

interface FeedbackRow {
  readonly question_id: string
  readonly rating: string
  readonly reason: string | null
  readonly created_at: Date
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

export function createPgAccountRepository(pool: pg.Pool): AccountRepository {
  return {
    export: (userId) =>
      inTransaction(pool, async (client) => {
        await client.query('SET TRANSACTION READ ONLY')
        const users = await client.query<UserRow>(
          `SELECT id, name, email, image, created_at, is_adult, terms_version, terms_accepted_at,
                  country_of_residence FROM auth."user" WHERE id = $1::uuid`,
          [userId],
        )
        const user = users.rows[0]
        if (user === undefined) {
          return null
        }
        const [accounts, passkeys, questions, feedback] = await Promise.all([
          client.query<{ provider_id: string }>(
            'SELECT provider_id FROM auth.account WHERE user_id = $1::uuid ORDER BY provider_id',
            [userId],
          ),
          client.query<{ total: number }>(
            'SELECT count(*)::int AS total FROM auth.passkey WHERE user_id = $1::uuid',
            [userId],
          ),
          client.query<QuestionRow>(
            `SELECT ${QUESTION_COLUMNS} FROM app.questions WHERE user_id = $1::uuid
             ORDER BY created_at, id`,
            [userId],
          ),
          client.query<FeedbackRow>(
            `SELECT question_id, rating, reason, created_at FROM app.feedback
             WHERE user_id = $1::uuid ORDER BY created_at, question_id`,
            [userId],
          ),
        ])
        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            createdAt: user.created_at,
            isAdult: user.is_adult,
            termsVersion: user.terms_version,
            termsAcceptedAt: user.terms_accepted_at,
            countryOfResidence: user.country_of_residence,
          },
          linkedAccounts: accounts.rows.map((row) => row.provider_id),
          passkeys: passkeys.rows[0]?.total ?? 0,
          questions: questions.rows.map((row) => toDetail(toRecord(row))),
          feedback: feedback.rows.map((row) => ({
            questionId: row.question_id,
            rating: row.rating,
            reason: row.reason,
            createdAt: row.created_at,
          })),
        }
      }),

    delete: (userId) =>
      inTransaction(pool, async (client) => {
        const { rowCount } = await client.query('DELETE FROM auth."user" WHERE id = $1::uuid', [
          userId,
        ])
        if (rowCount === 0) {
          return false
        }
        await client.query("DELETE FROM app.usage_daily WHERE scope = 'user:' || $1", [userId])
        await client.query("DELETE FROM app.rate_limits WHERE key LIKE '%|user:' || $1", [userId])
        return true
      }),
  }
}

export function createPgMaintenanceRepository(pool: pg.Pool): MaintenanceRepository {
  return {
    purge: (now, questionsBefore, pendingBefore) =>
      inTransaction(pool, async (client) => {
        const count = async (sql: string, parameters: unknown[]): Promise<number> =>
          (await client.query(sql, parameters)).rowCount ?? 0
        return {
          questions: await count('DELETE FROM app.questions WHERE created_at < $1', [
            questionsBefore,
          ]),
          expiredPending: await count(
            `UPDATE app.questions SET status = 'expired', updated_at = $2
             WHERE status = 'pending' AND created_at < $1`,
            [pendingBefore, now],
          ),
          answerCache: await count('DELETE FROM app.answer_cache WHERE expires_at <= $1', [now]),
          rateLimits: await count('DELETE FROM app.rate_limits WHERE expires_at <= $1', [now]),
          sessions: await count('DELETE FROM auth.session WHERE expires_at <= $1', [now]),
          verifications: await count('DELETE FROM auth.verification WHERE expires_at <= $1', [now]),
        }
      }),
  }
}
