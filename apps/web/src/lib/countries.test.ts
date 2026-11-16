import { describe, expect, it } from 'vitest'
import { countryOptions, DEFAULT_COUNTRY, isCountryCode, searchCountries } from './countries.ts'

describe('searchCountries', () => {
  const options = countryOptions('pt-BR')
  const codes = (query: string) => searchCountries(options, query).map((option) => option.code)

  it('busca vazia devolve tudo, na mesma ordem', () => {
    expect(searchCountries(options, '  ')).toEqual(options)
  })

  it('ignora acento e caixa', () => {
    expect(codes('sao tome')).toEqual(['ST'])
    expect(codes('ALEMANHA')).toEqual(['DE'])
  })

  it('o código exato e os nomes que começam pelo texto vêm antes dos que só o contêm', () => {
    expect(codes('pt')[0]).toBe('PT')
    const guinea = codes('guin')
    expect(guinea).toContain('GN')
    expect(guinea).toContain('PG')
    expect(guinea.indexOf('PG')).toBeGreaterThan(guinea.indexOf('GN'))
  })

  it('sem resultado, lista vazia', () => {
    expect(codes('atlântida')).toEqual([])
  })
})

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
