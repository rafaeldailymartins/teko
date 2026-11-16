import { describe, expect, it } from 'vitest'
import {
  APP_PAGES,
  isAppPage,
  localePagePath,
  NAVIGATION_PAGES,
  SITE_PAGES,
  switchLocaleHref,
  switchLocalePath,
} from './navigation.ts'

describe('páginas', () => {
  it('não repete página entre o app shell e o site', () => {
    const all = [...APP_PAGES, ...SITE_PAGES]
    expect(new Set(all).size).toBe(all.length)
  })

  it('a navegação só aponta para páginas existentes', () => {
    for (const page of NAVIGATION_PAGES) expect([...APP_PAGES, ...SITE_PAGES]).toContain(page)
  })
})

describe('isAppPage', () => {
  it('separa as páginas do app shell das públicas', () => {
    for (const page of APP_PAGES) expect(isAppPage(page)).toBe(true)
    for (const page of SITE_PAGES) expect(isAppPage(page)).toBe(false)
  })
})

describe('localePagePath', () => {
  it('gera o caminho com locale e barra final', () => {
    expect(localePagePath('pt-BR', 'chat')).toBe('/pt-BR/chat/')
    expect(localePagePath('en', 'sign-in')).toBe('/en/sign-in/')
  })
})

describe('switchLocalePath', () => {
  it('troca só o locale e mantém a página', () => {
    expect(switchLocalePath('/pt-BR/chat/', 'en')).toBe('/en/chat/')
    expect(switchLocalePath('/en/settings', 'pt-BR')).toBe('/pt-BR/settings/')
  })

  it('a inicial de um locale vira a inicial do outro', () => {
    expect(switchLocalePath('/pt-BR/', 'en')).toBe('/en/')
    expect(switchLocalePath('/en', 'pt-BR')).toBe('/pt-BR/')
  })

  it('fora de um locale vai para a inicial do destino', () => {
    expect(switchLocalePath('/', 'en')).toBe('/en/')
    expect(switchLocalePath('/fr/chat/', 'pt-BR')).toBe('/pt-BR/')
    expect(switchLocalePath('', 'en')).toBe('/en/')
  })
})

describe('switchLocaleHref', () => {
  const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash })

  it('mantém a página, a query e a âncora', () => {
    expect(switchLocaleHref(at('/pt-BR/chat/', '?c=abc&ref=2024-03'), 'en')).toBe(
      '/en/chat/?c=abc&ref=2024-03',
    )
    expect(switchLocaleHref(at('/en/privacy/', '', '#retencao'), 'pt-BR')).toBe(
      '/pt-BR/privacy/#retencao',
    )
    expect(switchLocaleHref(at('/en/provision', '?k=go:rcte:art:76', '#v2'), 'pt-BR')).toBe(
      '/pt-BR/provision/?k=go:rcte:art:76#v2',
    )
  })

  it('ignora query e âncora vazias', () => {
    expect(switchLocaleHref(at('/pt-BR/settings/', '?', '#'), 'en')).toBe('/en/settings/')
    expect(switchLocaleHref(at('/pt-BR/'), 'en')).toBe('/en/')
  })

  it('fora de um locale vai para a inicial do destino, sem a query', () => {
    expect(switchLocaleHref(at('/', '?c=abc'), 'en')).toBe('/en/')
    expect(switchLocaleHref(at('/fr/chat/', '?c=abc', '#x'), 'pt-BR')).toBe('/pt-BR/')
  })
})
