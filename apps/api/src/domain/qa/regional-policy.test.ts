import { describe, expect, it } from 'vitest'
import { requiresZeroRetention, ZERO_RETENTION_COUNTRIES } from './regional-policy.ts'

describe('requiresZeroRetention', () => {
  it('cobre a UE, o EEE, o Reino Unido e a Suíça (32 países)', () => {
    expect(ZERO_RETENTION_COUNTRIES.size).toBe(32)
    for (const country of ['PT', 'DE', 'NO', 'IS', 'LI', 'GB', 'CH']) {
      expect(requiresZeroRetention(country, null)).toBe(true)
    }
  })

  it('basta o país declarado ou o da requisição', () => {
    expect(requiresZeroRetention('BR', 'FR')).toBe(true)
    expect(requiresZeroRetention('ES', 'BR')).toBe(true)
    expect(requiresZeroRetention('BR', 'US')).toBe(false)
    expect(requiresZeroRetention(null, null)).toBe(false)
  })

  it('aceita minúsculas do header da plataforma', () => {
    expect(requiresZeroRetention(null, 'de')).toBe(true)
  })
})
