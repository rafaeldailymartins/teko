import { describe, expect, it } from 'vitest'
import { countryOptions, DEFAULT_COUNTRY, isCountryCode } from './countries.ts'

describe('countryOptions', () => {
  it('tem os 249 códigos ISO 3166-1 alpha-2, sem repetição', () => {
    const codes = countryOptions('en').map((option) => option.code)
    expect(codes).toHaveLength(249)
    expect(new Set(codes).size).toBe(249)
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true)
  })

  it('dá o nome no idioma da interface, em ordem alfabética desse idioma', () => {
    const pt = countryOptions('pt-BR')
    const en = countryOptions('en')
    expect(pt.find((option) => option.code === 'DE')?.name).toBe('Alemanha')
    expect(en.find((option) => option.code === 'DE')?.name).toBe('Germany')
    const names = pt.map((option) => option.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'pt-BR')))
  })
})

describe('isCountryCode', () => {
  it('reconhece só os códigos do seletor', () => {
    expect(isCountryCode(DEFAULT_COUNTRY)).toBe(true)
    expect(isCountryCode('PT')).toBe(true)
    expect(isCountryCode('XX')).toBe(false)
    expect(isCountryCode('br')).toBe(false)
    expect(isCountryCode(null)).toBe(false)
    expect(isCountryCode(undefined)).toBe(false)
  })
})
