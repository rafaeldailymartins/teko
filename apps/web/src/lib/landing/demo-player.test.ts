import { describe, expect, it } from 'vitest'
import { DemoPlayer, type DemoScheduler, PauseReason } from './demo-player.ts'
import { DemoPhase, type DemoStep } from './demo-timeline.ts'

/** Relógio manual: guarda o timer agendado e o dispara sob demanda. */
class ManualScheduler implements DemoScheduler {
  pending: { callback: () => void; delay: number; id: number } | null = null
  cancelled = 0
  #next = 0

  schedule(callback: () => void, delay: number): unknown {
    this.#next += 1
    this.pending = { callback, delay, id: this.#next }
    return this.#next
  }

  cancel(handle: unknown): void {
    if (this.pending?.id === handle) {
      this.pending = null
      this.cancelled += 1
    }
  }

  fire(): void {
    const pending = this.pending
    this.pending = null
    pending?.callback()
  }
}

function step(hold: number): DemoStep {
  return { frame: { phase: DemoPhase.Idle, typed: 0, reference: null, exchanges: [] }, hold }
}

const STEPS = [step(100), step(200), step(300), step(400)]

function setup(paused: readonly PauseReason[] = []) {
  const scheduler = new ManualScheduler()
  const seen: number[] = []
  const player = new DemoPlayer({
    steps: STEPS,
    finalIndex: 2,
    onStep: (index) => seen.push(index),
    scheduler,
    paused,
  })
  return { scheduler, seen, player }
}

describe('DemoPlayer', () => {
  it('começa no quadro final e anda em loop com o hold de cada passo', () => {
    const { scheduler, seen, player } = setup()
    expect(player.index).toBe(2)
    expect(scheduler.pending?.delay).toBe(300)
    scheduler.fire()
    expect(scheduler.pending?.delay).toBe(400)
    scheduler.fire()
    scheduler.fire()
    expect(seen).toEqual([3, 0, 1])
    expect(player.playing).toBe(true)
  })

  it('fora da tela desde o início, só anda quando aparece', () => {
    const { scheduler, seen, player } = setup([PauseReason.Offscreen])
    expect(player.playing).toBe(false)
    expect(scheduler.pending).toBeNull()
    player.setPaused(PauseReason.Offscreen, false)
    expect(scheduler.pending?.delay).toBe(300)
    scheduler.fire()
    expect(seen).toEqual([3])
  })

  it('pausa por qualquer motivo e só retoma sem nenhum', () => {
    const { scheduler, seen, player } = setup()
    player.setPaused(PauseReason.Hidden, true)
    player.setPaused(PauseReason.User, true)
    expect(scheduler.pending).toBeNull()
    expect(scheduler.cancelled).toBe(1)
    player.setPaused(PauseReason.Hidden, false)
    expect(player.playing).toBe(false)
    expect(player.isPausedBy(PauseReason.User)).toBe(true)
    player.setPaused(PauseReason.User, false)
    // Retoma do mesmo quadro, com o tempo inteiro dele.
    expect(scheduler.pending?.delay).toBe(300)
    expect(seen).toEqual([])
  })

  it('pedir a mesma pausa duas vezes não muda nada', () => {
    const { scheduler, player } = setup()
    player.setPaused(PauseReason.User, false)
    expect(scheduler.pending?.id).toBe(1)
    player.setPaused(PauseReason.User, true)
    player.setPaused(PauseReason.User, true)
    expect(scheduler.cancelled).toBe(1)
  })

  it('movimento reduzido vai para o quadro final e para; ao desligar, volta a andar', () => {
    const { scheduler, seen, player } = setup()
    scheduler.fire()
    expect(player.index).toBe(3)
    player.setReducedMotion(true)
    expect(player.index).toBe(2)
    expect(scheduler.pending).toBeNull()
    player.setReducedMotion(true)
    player.setPaused(PauseReason.User, true)
    player.setPaused(PauseReason.User, false)
    expect(scheduler.pending).toBeNull()
    player.setReducedMotion(false)
    expect(scheduler.pending?.delay).toBe(300)
    expect(seen).toEqual([3, 2])
  })

  it('movimento reduzido já no quadro final não avisa de novo', () => {
    const { seen, player } = setup()
    player.setReducedMotion(true)
    expect(seen).toEqual([])
  })

  it('dispose cancela o timer e ignora pedidos depois', () => {
    const { scheduler, player } = setup()
    player.dispose()
    expect(scheduler.pending).toBeNull()
    player.setPaused(PauseReason.User, true)
    player.setPaused(PauseReason.User, false)
    expect(scheduler.pending).toBeNull()
  })

  it('o primeiro quadro pode ficar menos tempo só na primeira vez', () => {
    const scheduler = new ManualScheduler()
    new DemoPlayer({
      steps: STEPS,
      finalIndex: 2,
      onStep: () => undefined,
      scheduler,
      firstHold: 50,
    })
    expect(scheduler.pending?.delay).toBe(50)
    scheduler.fire()
    scheduler.fire()
    scheduler.fire()
    scheduler.fire()
    // De volta ao passo 2 depois de uma volta: o hold normal dele.
    expect(scheduler.pending?.delay).toBe(300)
  })

  it('roteiro de um passo só não agenda nada', () => {
    const scheduler = new ManualScheduler()
    const player = new DemoPlayer({
      steps: [step(100)],
      finalIndex: 0,
      onStep: () => undefined,
      scheduler,
    })
    expect(player.playing).toBe(false)
  })
})
