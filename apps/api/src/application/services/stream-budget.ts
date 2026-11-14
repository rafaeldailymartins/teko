import type { InvocationDeadline } from '../ports/invocation-deadline.ts'

/**
 * Teto efetivo de um stream de resposta (Streaming, item 4 do plano):
 * `min(100 s, prazo da invocação − agora − 20 s)`.
 *
 * Os 20 s de reserva sobram para a finalização (transação curta) e para as tarefas de
 * `BackgroundTasks`, que dividem o prazo da invocação. Sem prazo de plataforma (Render, CI,
 * local), vale só o teto de 100 s. O resultado nunca é negativo: `0` significa "sem prazo para
 * começar um stream".
 */
export const STREAM_CAP_MS = 100_000
export const STREAM_DEADLINE_RESERVE_MS = 20_000

export interface StreamBudget {
  /** Teto, em ms, de um stream que começa em `nowMs` numa invocação iniciada em `startedAtMs`. */
  timeoutMs(startedAtMs: number, nowMs: number): number
}

export function createStreamBudget(
  deadline: InvocationDeadline,
  capMs: number = STREAM_CAP_MS,
): StreamBudget {
  return {
    timeoutMs(startedAtMs, nowMs) {
      const deadlineMs = deadline.deadlineFor(startedAtMs)
      if (deadlineMs === null) {
        return capMs
      }
      const remaining = deadlineMs - nowMs - STREAM_DEADLINE_RESERVE_MS
      return Math.max(0, Math.min(capMs, remaining))
    },
  }
}
