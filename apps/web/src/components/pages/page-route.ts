import type { Locale } from '@teko/shared/i18n'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { languageAlternates, routing } from '@/lib/i18n/routing'
import { localePagePath, type Page } from '@/lib/navigation'

/** Props das páginas em `src/app/[locale]/…/page.tsx` (export estático: params já resolvidos). */
export interface LocalePageProps {
  readonly params: Promise<{ locale: string }>
}

/** Valida o locale do segmento e o fixa para o next-intl (sem isso o export estático falha). */
export async function resolvePageLocale(params: LocalePageProps['params']): Promise<Locale> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  return locale
}

/** `generateMetadata` de uma página: título, descrição, canonical e hreflang dos dois idiomas. */
export function pageMetadata(page: Page) {
  return async function generateMetadata({ params }: LocalePageProps): Promise<Metadata> {
    const { locale } = await params
    if (!hasLocale(routing.locales, locale)) {
      return {}
    }
    const t = await getTranslations({ locale, namespace: 'pages' })
    return {
      title: t(`${page}.title`),
      description: t(`${page}.description`),
      alternates: {
        canonical: localePagePath(locale, page),
        languages: languageAlternates(`/${page}/`),
      },
    }
  }
}
