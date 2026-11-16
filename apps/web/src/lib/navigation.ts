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
 * para a inicial do destino.
 */
export function switchLocalePath(pathname: string, target: Locale): string {
  const [, first, ...rest] = pathname.split('/')
  if (!isLocale(first)) {
    return localeHomePath(target)
  }
  const tail = rest.filter((segment) => segment !== '').join('/')
  return tail === '' ? localeHomePath(target) : `/${target}/${tail}/`
}

/**
 * Destino da troca de idioma: o mesmo caminho em outro locale com a query e a âncora atuais (a
 * conversa aberta, a data de referência, a seção da página). A query do Tekó só leva ids e datas
 * (`src/lib/url-state.ts`), nunca o texto da pergunta, e a navegação fica na mesma origem. Fora de
 * um locale, vai para a inicial do destino, sem a query.
 */
export function switchLocaleHref(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  target: Locale,
): string {
  const path = switchLocalePath(location.pathname, target)
  const [, first] = location.pathname.split('/')
  if (!isLocale(first)) {
    return path
  }
  const search =
    location.search.startsWith('?') && location.search.length > 1 ? location.search : ''
  const hash = location.hash.startsWith('#') && location.hash.length > 1 ? location.hash : ''
  return `${path}${search}${hash}`
}
