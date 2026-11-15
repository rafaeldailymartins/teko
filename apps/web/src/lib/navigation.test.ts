import { describe, expect, it } from 'vitest'
import {
  APP_PAGES,
  isAppPage,
  localePagePath,
  NAVIGATION_PAGES,
  SITE_PAGES,
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
