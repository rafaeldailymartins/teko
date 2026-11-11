import type { Clock } from '#app/ports/clock.ts'

/** Relógio do sistema operacional (produção). */
export const systemClock: Clock = {
  now: () => new Date(),
}
