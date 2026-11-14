import { describe, expect, it } from 'vitest'
import { nextMidnightMs } from './time-zone.ts'

const PACIFIC = 'America/Los_Angeles'

describe('nextMidnightMs', () => {
  it('no horário de inverno do Pacífico (UTC−8)', () => {
    const now = Date.parse('2026-11-10T15:00:00Z')
    expect(new Date(nextMidnightMs(now, PACIFIC)).toISOString()).toBe('2026-11-11T08:00:00.000Z')
  })

  it('no horário de verão do Pacífico (UTC−7)', () => {
    const now = Date.parse('2026-07-01T06:59:59Z')
    expect(new Date(nextMidnightMs(now, PACIFIC)).toISOString()).toBe('2026-07-01T07:00:00.000Z')
  })

  it('no dia em que o horário de verão acaba, a meia-noite seguinte já é UTC−8', () => {
    const now = Date.parse('2026-11-01T12:00:00Z')
    expect(new Date(nextMidnightMs(now, PACIFIC)).toISOString()).toBe('2026-11-02T08:00:00.000Z')
  })

  it('em São Paulo (UTC−3, sem horário de verão)', () => {
    const now = Date.parse('2026-11-10T02:59:00Z')
    expect(new Date(nextMidnightMs(now, 'America/Sao_Paulo')).toISOString()).toBe(
      '2026-11-10T03:00:00.000Z',
    )
  })
})
