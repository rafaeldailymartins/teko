import type { Locale } from '@teko/shared/i18n'
import { localeHomePath, routing } from './i18n/routing.ts'

/**
 * Páginas do app, cada uma em `src/app/[locale]/…/<página>/page.tsx`. As do app shell ficam no grupo
 * `(app)` (cabeçalho com paleta e painéis); as públicas usam o cabeçalho e o rodapé do site.
 */
export const APP_PAGES = ['chat', 'history', 'settings', 'provision', 'compare'] as const
export const SITE_PAGES = ['coverage', 'about', 'privacy', 'terms', 'sign-in'] as const

export type AppPage = (typeof APP_PAGES)[number]
export type Page = AppPage | (typeof SITE_PAGES)[number]

/**
 * Destinos da paleta (`Ctrl/⌘+K`) e da navegação do cabeçalho, na ordem em que aparecem.
 * `provision` e `compare` ficam de fora: só fazem sentido com um dispositivo na query.
 */
export const NAVIGATION_PAGES = [
  'chat',
  'history',
  'coverage',
  'settings',
  'about',
  'privacy',
  'terms',
] as const satisfies readonly Page[]

/** Se a página fica no app shell (grupo `(app)`) ou no site público. */
export function isAppPage(page: Page): page is AppPage {
  return APP_PAGES.some((appPage) => appPage === page)
}

/** Caminho de uma página num locale, coerente com `trailingSlash: true`. */
export function localePagePath(locale: Locale, page: Page): `/${Locale}/${Page}/` {
  return `/${locale}/${page}/`
}

function isLocale(segment: string | undefined): segment is Locale {
  return routing.locales.some((locale) => locale === segment)
}

/**
 * O mesmo caminho em outro locale (troca de idioma sem perder a página). Fora de um locale, vai
 * para a inicial do destino. A query não entra: ela pode levar dados da conversa.
 */
export function switchLocalePath(pathname: string, target: Locale): string {
  const [, first, ...rest] = pathname.split('/')
  if (!isLocale(first)) {
    return localeHomePath(target)
  }
  const tail = rest.filter((segment) => segment !== '').join('/')
  return tail === '' ? localeHomePath(target) : `/${target}/${tail}/`
}
