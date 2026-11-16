import { QuotaScope } from '@teko/shared/errors'
import type {
  AcceptDecision,
  UsageCaps,
  UsageReservation,
  UsageSnapshot,
} from '../ports/question-repository.ts'
import { type QuotaUsage, QuotaUsageScope } from '../ports/telemetry.ts'

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

function ratioOf(used: number, cap: number): number {
  return cap <= 0 ? 1 : used / cap
}

/**
 * Uso da cota global do dia sobre o teto, por recurso (`teko.quota.used_ratio`; o alerta do
 * Grafana dispara acima de 0,7). Lido do mesmo snapshot do `decideQuota`, antes da reserva desta
 * pergunta.
 */
export function quotaUsage(usage: UsageSnapshot, caps: UsageCaps): QuotaUsage[] {
  return [
    {
      scope: QuotaUsageScope.Questions,
      ratio: ratioOf(usage.globalRequests, caps.questionsGlobal),
    },
    {
      scope: QuotaUsageScope.StreamSeconds,
      ratio: ratioOf(usage.globalStreamSeconds, caps.streamSecondsGlobal),
    },
    { scope: QuotaUsageScope.Neurons, ratio: ratioOf(usage.globalNeurons, caps.neuronsGlobal) },
  ]
}
