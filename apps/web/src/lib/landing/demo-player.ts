import type { DemoStep } from './demo-timeline.ts'

/**
 * Motivos para a demonstração ficar parada. Ela só anda sem nenhum:
 * - `offscreen`: fora da tela (IntersectionObserver);
 * - `hidden`: aba oculta (`document.hidden`);
 * - `user`: o botão de pausa (WCAG 2.2.2).
 */
export const PauseReason = {
  Offscreen: 'offscreen',
  Hidden: 'hidden',
  User: 'user',
} as const
export type PauseReason = (typeof PauseReason)[keyof typeof PauseReason]

/** O relógio do player: `setTimeout` do navegador, ou um falso nos testes. */
export interface DemoScheduler {
  schedule(callback: () => void, delay: number): unknown
  cancel(handle: unknown): void
}

const browserScheduler: DemoScheduler = {
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: (handle) => window.clearTimeout(handle as number),
}

interface DemoPlayerOptions {
  readonly steps: readonly DemoStep[]
  /** Passo inicial e o de movimento reduzido (o quadro final). */
  readonly finalIndex: number
  readonly onStep: (index: number) => void
  readonly scheduler?: DemoScheduler
  /** Motivos de pausa já valendo ao criar (por exemplo, fora da tela até o observer dizer). */
  readonly paused?: readonly PauseReason[]
  /** Tempo do passo inicial na primeira vez (padrão: o `hold` dele). */
  readonly firstHold?: number
}

/**
 * Toca o roteiro em loop: agenda o próximo passo com o `hold` do atual e avisa cada mudança. Com
 * qualquer motivo de pausa, o timer é cancelado e o quadro fica; ao retomar, o quadro atual ganha o
 * tempo inteiro de novo. Com movimento reduzido, o player vai para o quadro final e não anda.
 */
export class DemoPlayer {
  readonly #steps: readonly DemoStep[]
  readonly #finalIndex: number
  readonly #onStep: (index: number) => void
  readonly #scheduler: DemoScheduler
  readonly #reasons: Set<PauseReason>
  #index: number
  #handle: unknown = null
  #firstHold: number | null
  #reducedMotion = false
  #disposed = false

  constructor({ steps, finalIndex, onStep, scheduler, paused = [], firstHold }: DemoPlayerOptions) {
    this.#steps = steps
    this.#finalIndex = finalIndex
    this.#index = finalIndex
    this.#onStep = onStep
    this.#scheduler = scheduler ?? browserScheduler
    this.#reasons = new Set(paused)
    this.#firstHold = firstHold ?? null
    this.#arm()
  }

  get index(): number {
    return this.#index
  }

  /** Se o roteiro está andando (com um próximo passo agendado). */
  get playing(): boolean {
    return this.#handle !== null
  }

  /** Liga ou desliga um motivo de pausa. */
  setPaused(reason: PauseReason, paused: boolean): void {
    const had = this.#reasons.has(reason)
    if (paused === had) return
    if (paused) {
      this.#reasons.add(reason)
      this.#disarm()
    } else {
      this.#reasons.delete(reason)
      this.#arm()
    }
  }

  isPausedBy(reason: PauseReason): boolean {
    return this.#reasons.has(reason)
  }

  /** Movimento reduzido: vai para o quadro final e para; ao desligar, volta a andar dali. */
  setReducedMotion(reduced: boolean): void {
    if (reduced === this.#reducedMotion) return
    this.#reducedMotion = reduced
    if (reduced) {
      this.#disarm()
      this.#go(this.#finalIndex)
    } else {
      this.#arm()
    }
  }

  dispose(): void {
    this.#disposed = true
    this.#disarm()
  }

  #go(index: number): void {
    if (index === this.#index) return
    this.#index = index
    this.#onStep(index)
  }

  #arm(): void {
    if (this.#disposed || this.#reducedMotion || this.#reasons.size > 0) return
    if (this.#handle !== null || this.#steps.length < 2) return
    const hold = this.#firstHold ?? this.#steps[this.#index]?.hold ?? 0
    this.#handle = this.#scheduler.schedule(() => {
      this.#handle = null
      this.#firstHold = null
      this.#go((this.#index + 1) % this.#steps.length)
      this.#arm()
    }, hold)
  }

  #disarm(): void {
    if (this.#handle === null) return
    this.#scheduler.cancel(this.#handle)
    this.#handle = null
  }
}
