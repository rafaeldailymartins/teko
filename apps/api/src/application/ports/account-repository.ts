import type { QuestionDetail } from '@teko/shared/contracts'

/**
 * Dados pessoais de um usuário no Postgres, para os direitos do titular (LGPD): exportação
 * completa e exclusão. A exclusão apaga `auth.user`, e o `ON DELETE CASCADE` leva sessões, contas
 * OAuth, passkeys, perguntas e feedback; as linhas de uso e de rate limit com a chave do usuário
 * saem na mesma transação.
 */
export interface AccountExport {
  readonly user: {
    readonly id: string
    readonly name: string
    readonly email: string
    readonly image: string | null
    readonly createdAt: Date
    readonly isAdult: boolean
    readonly termsVersion: string | null
    readonly termsAcceptedAt: Date | null
    readonly countryOfResidence: string | null
  }
  /** Provedores OAuth ligados (só o nome; tokens nunca saem). */
  readonly linkedAccounts: readonly string[]
  readonly passkeys: number
  readonly questions: readonly QuestionDetail[]
  readonly feedback: readonly {
    readonly questionId: string
    readonly rating: string
    readonly reason: string | null
    readonly createdAt: Date
  }[]
}

export interface AccountRepository {
  /** `null` quando o usuário não existe mais. */
  export(userId: string): Promise<AccountExport | null>
  /** Apaga o usuário e tudo o que é dele; `false` se ele já não existia. */
  delete(userId: string): Promise<boolean>
}

/** Apagamento nos sistemas de terceiros (PostHog e Langfuse, a partir da F6). */
export interface ErasurePort {
  readonly name: string
  eraseUser(userId: string): Promise<void>
}

/** Expurgo da manutenção semanal (`PurgeExpiredData`). */
export interface PurgeCounts {
  readonly questions: number
  readonly expiredPending: number
  readonly answerCache: number
  readonly rateLimits: number
  readonly sessions: number
  readonly verifications: number
}

export interface MaintenanceRepository {
  /**
   * Perguntas (e o feedback delas) criadas antes de `questionsBefore`; `pending` criadas antes de
   * `pendingBefore` viram `expired`; cache, janelas de rate limit, sessões e verificações vencidas
   * em `now` saem.
   */
  purge(now: Date, questionsBefore: Date, pendingBefore: Date): Promise<PurgeCounts>
}
