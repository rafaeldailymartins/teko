import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../errors/codes.ts'
import {
  DEFAULT_LOCALE,
  errorMessageKey,
  isLocale,
  LOCALES,
  localeSchema,
  resolveLocale,
} from './index.ts'

describe('locales', () => {
  it('suporta pt-BR (padrão) e en', () => {
    expect(LOCALES).toEqual(['pt-BR', 'en'])
    expect(DEFAULT_LOCALE).toBe('pt-BR')
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })

  it('valida locales', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('pt-br')).toBe(false)
    expect(isLocale('pt')).toBe(false)
    expect(isLocale(undefined)).toBe(false)
    expect(localeSchema.parse('pt-BR')).toBe('pt-BR')
  })

  it('cai no padrão para valores desconhecidos', () => {
    expect(resolveLocale('en')).toBe('en')
    expect(resolveLocale('fr')).toBe('pt-BR')
    expect(resolveLocale(null)).toBe('pt-BR')
  })

  it('gera uma chave errors.<code> por código de erro', () => {
    expect(errorMessageKey('quota_exceeded')).toBe('errors.quota_exceeded')
    expect(new Set(ERROR_CODES.map(errorMessageKey)).size).toBe(ERROR_CODES.length)
  })
})
