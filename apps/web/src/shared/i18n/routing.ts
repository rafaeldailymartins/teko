import { DEFAULT_LOCALE, LOCALES, type Locale } from '@teko/shared/i18n'
import { defineRouting } from 'next-intl/routing'

/**
 * Roteamento i18n para export estático: prefixo de locale sempre presente (`/pt-BR/`, `/en/`),
 * sem detecção no servidor (não há proxy/middleware). A escolha inicial do idioma em `/` fica com
 * o `_redirects` da Netlify (`Language=en`) e, fora dela, com a página de entrada estática.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false,
  alternateLinks: false,
})

/** Nome de cada idioma na própria língua (endônimo): não se traduz. */
export const LOCALE_ENDONYMS: Readonly<Record<Locale, string>> = {
  'pt-BR': 'Português',
  en: 'English',
}

/**
 * `og:locale` de cada idioma. O Open Graph exige `language_TERRITORY` (`en` sozinho não segue o
 * formato e é ignorado), então o mapa é explícito em vez de trocar `-` por `_`.
 */
const OPEN_GRAPH_LOCALES: Readonly<Record<Locale, `${string}_${string}`>> = {
  'pt-BR': 'pt_BR',
  en: 'en_US',
}

/** Valor de `og:locale` de um locale do app. */
export function openGraphLocale(locale: Locale): string {
  return OPEN_GRAPH_LOCALES[locale]
}

/** Valores de `og:locale:alternate`: os outros locales, no formato do Open Graph. */
export function openGraphAlternateLocales(current: Locale): string[] {
  return alternateLocales(current).map(openGraphLocale)
}

/** Caminho da página inicial de um locale, coerente com `trailingSlash: true`. */
export function localeHomePath(locale: Locale): `/${Locale}/` {
  return `/${locale}/`
}

/** Locales diferentes do atual, na ordem de `LOCALES` (para o seletor de idioma). */
export function alternateLocales(current: Locale): readonly Locale[] {
  return routing.locales.filter((locale) => locale !== current)
}

/**
 * Mapa `hreflang → caminho` de uma página presente em todos os locales, para
 * `metadata.alternates.languages`. `x-default` aponta para o locale padrão.
 */
export function languageAlternates(pathWithinLocale = ''): Record<Locale | 'x-default', string> {
  const suffix = pathWithinLocale.replace(/^\/+/, '')
  const entries = routing.locales.map((locale) => [locale, `${localeHomePath(locale)}${suffix}`])
  const alternates = Object.fromEntries(entries) as Record<Locale, string>
  return { ...alternates, 'x-default': alternates[routing.defaultLocale] }
}
