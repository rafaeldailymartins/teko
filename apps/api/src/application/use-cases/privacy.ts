import type { MeExport } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'
import { ApplicationError } from '../errors.ts'
import type {
  AccountRepository,
  ErasurePort,
  MaintenanceRepository,
  PurgeCounts,
} from '../ports/account-repository.ts'
import type { BackgroundTasks } from '../ports/background-tasks.ts'
import type { Clock } from '../ports/clock.ts'

/**
 * Direitos do titular e retenção (`docs/architecture/qualidade-e-seguranca.md`, "LGPD"):
 *
 * - `ExportMyData` (`GET /me/export`): tudo o que o Tekó guarda do usuário, num JSON;
 * - `DeleteMyData` (`DELETE /me`): apaga a conta e tudo o que é dela no Postgres, na hora, e pede o
 *   apagamento nos terceiros (PostHog e Langfuse, F6) como tarefas pós-resposta; uma falha nelas
 *   fica no log para o tratamento manual, dentro do SLA de 15 dias;
 * - `PurgeExpiredData` (manutenção semanal): conversas com mais de 90 dias, `pending` com mais de
 *   1 dia viram `expired`, e o que venceu sai.
 *
 * As rotas leem a sessão do banco (sem o `cookieCache`): uma sessão revogada nunca exporta nem
 * apaga.
 */
const QUESTION_RETENTION_DAYS = 90
const PENDING_EXPIRY_DAYS = 1
const DAY_MS = 86_400_000
/** Teto de cada pedido de apagamento num terceiro. */
const ERASURE_TIMEOUT_MS = 5000

export interface PrivacyUseCases {
  exportMyData(userId: string): Promise<MeExport>
  deleteMyData(userId: string): Promise<void>
}

export function createPrivacyUseCases(deps: {
  readonly accounts: AccountRepository
  readonly erasure: readonly ErasurePort[]
  readonly backgroundTasks: BackgroundTasks
  readonly clock: Clock
}): PrivacyUseCases {
  return {
    async exportMyData(userId) {
      const data = await deps.accounts.export(userId)
      if (data === null) {
        throw new ApplicationError({ code: ErrorCode.Unauthenticated })
      }
      return {
        exportedAt: deps.clock.now().toISOString(),
        user: {
          ...data.user,
          createdAt: data.user.createdAt.toISOString(),
          termsAcceptedAt: data.user.termsAcceptedAt?.toISOString() ?? null,
        },
        linkedAccounts: [...data.linkedAccounts],
        passkeys: data.passkeys,
        questions: [...data.questions],
        feedback: data.feedback.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
      }
    },
    async deleteMyData(userId) {
      const deleted = await deps.accounts.delete(userId)
      if (!deleted) {
        throw new ApplicationError({ code: ErrorCode.Unauthenticated })
      }
      for (const port of deps.erasure) {
        deps.backgroundTasks.run(`erasure:${port.name}`, port.eraseUser(userId), {
          timeoutMs: ERASURE_TIMEOUT_MS,
        })
      }
    },
  }
}

export type PurgeExpiredData = () => Promise<PurgeCounts>

export function createPurgeExpiredData(deps: {
  readonly maintenance: MaintenanceRepository
  readonly clock: Clock
}): PurgeExpiredData {
  return () => {
    const now = deps.clock.now()
    return deps.maintenance.purge(
      now,
      new Date(now.getTime() - QUESTION_RETENTION_DAYS * DAY_MS),
      new Date(now.getTime() - PENDING_EXPIRY_DAYS * DAY_MS),
    )
  }
}
