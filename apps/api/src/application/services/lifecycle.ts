import { HealthStatus } from '@teko/shared/contracts'
import type { Clock } from '../ports/clock.ts'

/**
 * Estado de vida do processo. No SIGTERM o processo entra em drenagem: `/healthz` passa a
 * responder 503 (o proxy da frente para de mandar tráfego) e, a partir da F4, novos streams de
 * resposta também recebem 503 enquanto os ativos terminam. Na Vercel, cada deploy é uma
 * deployment imutável nova, e o SIGTERM só chega no scale-down da instância.
 *
 * A transição é de mão única (`ok` → `draining`): um processo em drenagem nunca volta a receber
 * tráfego.
 */
export interface Lifecycle {
  status(): HealthStatus
  isDraining(): boolean
  /**
   * Entra em drenagem. Idempotente: devolve `true` só na primeira chamada, para o chamador
   * saber se é ele quem conduz o encerramento.
   */
  beginDraining(): boolean
  /** Há quanto tempo o processo está drenando, em ms; `null` se ainda não começou. */
  drainingForMs(): number | null
}

export function createLifecycle(clock: Clock): Lifecycle {
  let drainingSince: number | null = null

  return {
    status: () => (drainingSince === null ? HealthStatus.Ok : HealthStatus.Draining),
    isDraining: () => drainingSince !== null,
    beginDraining() {
      if (drainingSince !== null) {
        return false
      }
      drainingSince = clock.now().getTime()
      return true
    },
    drainingForMs: () =>
      drainingSince === null ? null : Math.max(0, clock.now().getTime() - drainingSince),
  }
}
