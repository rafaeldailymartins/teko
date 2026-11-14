import { QuotaScope } from '@teko/shared/errors'
import type {
  AcceptDecision,
  UsageCaps,
  UsageReservation,
  UsageSnapshot,
} from '../ports/question-repository.ts'

/**
 * `QuotaGuard` (`docs/architecture/backend.md`, "Pergunta e streaming"): decide, sob o advisory
 * lock do usuário, se uma pergunta que vai precisar de stream pode ser aceita.
 *
 * - um stream ativo do mesmo usuário → `stream_busy` (1 por usuário);
 * - teto de perguntas do usuário → `quota_exceeded` `user_daily`;
 * - teto global de perguntas, de segundos de stream (com a reserva de 100 s) ou de neurons →
 *   `quota_exceeded` `global_daily`.
 *
 * Acertos do cache e recusas sem LLM não passam por aqui.
 */
export function decideQuota(
  usage: UsageSnapshot,
  caps: UsageCaps,
  reservation: UsageReservation,
): AcceptDecision {
  if (usage.activeStream) {
    return { kind: 'busy' }
  }
  if (usage.userRequests >= caps.questionsPerUser) {
    return { kind: 'quota', scope: QuotaScope.UserDaily }
  }
  const globalFull =
    usage.globalRequests >= caps.questionsGlobal ||
    usage.globalStreamSeconds + reservation.streamSeconds > caps.streamSecondsGlobal ||
    usage.globalNeurons + reservation.neurons > caps.neuronsGlobal
  return globalFull ? { kind: 'quota', scope: QuotaScope.GlobalDaily } : { kind: 'ok' }
}
