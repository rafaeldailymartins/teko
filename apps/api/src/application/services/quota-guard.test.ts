import { describe, expect, it } from 'vitest'
import { decideQuota } from './quota-guard.ts'

const CAPS = {
  questionsGlobal: 300,
  questionsPerUser: 30,
  streamSecondsGlobal: 6000,
  neuronsGlobal: 800,
}
const RESERVATION = { streamSeconds: 100, neurons: 5 }
const IDLE = {
  globalRequests: 0,
  userRequests: 0,
  globalStreamSeconds: 0,
  globalNeurons: 0,
  activeStream: false,
}

describe('decideQuota', () => {
  it('aceita abaixo de todos os tetos', () => {
    expect(decideQuota(IDLE, CAPS, RESERVATION)).toEqual({ kind: 'ok' })
  })

  it('stream ativo do usuário vem antes das cotas', () => {
    expect(
      decideQuota({ ...IDLE, activeStream: true, userRequests: 99 }, CAPS, RESERVATION),
    ).toEqual({
      kind: 'busy',
    })
  })

  it('teto do usuário → user_daily, no limite exato', () => {
    expect(decideQuota({ ...IDLE, userRequests: 29 }, CAPS, RESERVATION)).toEqual({ kind: 'ok' })
    expect(decideQuota({ ...IDLE, userRequests: 30 }, CAPS, RESERVATION)).toEqual({
      kind: 'quota',
      scope: 'user_daily',
    })
  })

  it.each([
    ['perguntas', { globalRequests: 300 }],
    ['segundos de stream com a reserva', { globalStreamSeconds: 5901 }],
    ['neurons com a reserva', { globalNeurons: 796 }],
  ])('teto global de %s → global_daily', (_name, usage) => {
    expect(decideQuota({ ...IDLE, ...usage }, CAPS, RESERVATION)).toEqual({
      kind: 'quota',
      scope: 'global_daily',
    })
  })

  it('a reserva cabe exatamente no teto', () => {
    expect(
      decideQuota({ ...IDLE, globalStreamSeconds: 5900, globalNeurons: 795 }, CAPS, RESERVATION),
    ).toEqual({
      kind: 'ok',
    })
  })
})
