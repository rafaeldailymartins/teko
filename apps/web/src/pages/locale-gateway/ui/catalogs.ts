import type { Locale } from '@teko/shared/i18n'
import { loadMessages, type Messages, routing } from '@/shared/i18n'

/** Catálogos de todos os locales, para páginas que mostram os dois idiomas lado a lado. */
export async function loadAllCatalogs(): Promise<Readonly<Record<Locale, Messages>>> {
  const entries = await Promise.all(
    routing.locales.map(async (locale) => [locale, await loadMessages(locale)] as const),
  )
  return Object.fromEntries(entries) as Record<Locale, Messages>
}

/** Extrai um texto de cada catálogo. */
export function pickFromCatalogs(
  catalogs: Readonly<Record<Locale, Messages>>,
  select: (messages: Messages) => string,
): Record<Locale, string> {
  const entries = routing.locales.map((locale) => [locale, select(catalogs[locale])] as const)
  return Object.fromEntries(entries) as Record<Locale, string>
}
