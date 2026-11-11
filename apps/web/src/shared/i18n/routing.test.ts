import { DEFAULT_LOCALE, LOCALES } from '@teko/shared/i18n'
import { describe, expect, it } from 'vitest'
import {
  alternateLocales,
  LOCALE_ENDONYMS,
  languageAlternates,
  localeHomePath,
  openGraphAlternateLocales,
  openGraphLocale,
  routing,
} from './routing.ts'

describe('routing', () => {
  it('usa os locales de @teko/shared com prefixo sempre presente', () => {
    expect(routing.locales).toEqual(LOCALES)
    expect(routing.defaultLocale).toBe(DEFAULT_LOCALE)
    expect(routing.localePrefix).toBe('always')
    expect(routing.localeDetection).toBe(false)
  })

  it('tem endônimo para cada locale', () => {
    expect(Object.keys(LOCALE_ENDONYMS).sort()).toEqual([...LOCALES].sort())
  })
})

describe('localeHomePath', () => {
  it('gera caminhos com barra final (trailingSlash: true)', () => {
    expect(localeHomePath('pt-BR')).toBe('/pt-BR/')
    expect(localeHomePath('en')).toBe('/en/')
  })
})

describe('alternateLocales', () => {
  it('lista os outros locales, sem o atual', () => {
    expect(alternateLocales('pt-BR')).toEqual(['en'])
    expect(alternateLocales('en')).toEqual(['pt-BR'])
  })
})

describe('openGraphLocale', () => {
  it('converte para language_TERRITORY do Open Graph', () => {
    expect(openGraphLocale('pt-BR')).toBe('pt_BR')
    expect(openGraphLocale('en')).toBe('en_US')
  })

  it.each(LOCALES)('%s vira um og:locale válido', (locale) => {
    expect(openGraphLocale(locale)).toMatch(/^[a-z]{2}_[A-Z]{2}$/)
  })
})

describe('openGraphAlternateLocales', () => {
  it('lista os outros locales no formato do Open Graph', () => {
    expect(openGraphAlternateLocales('pt-BR')).toEqual(['en_US'])
    expect(openGraphAlternateLocales('en')).toEqual(['pt_BR'])
  })
})

describe('languageAlternates', () => {
  it('mapeia cada locale e x-default para a inicial', () => {
    expect(languageAlternates()).toEqual({
      'pt-BR': '/pt-BR/',
      en: '/en/',
      'x-default': '/pt-BR/',
    })
  })

  it('anexa o caminho interno sem barras duplicadas', () => {
    expect(languageAlternates('/about/')).toEqual({
      'pt-BR': '/pt-BR/about/',
      en: '/en/about/',
      'x-default': '/pt-BR/about/',
    })
  })
})
