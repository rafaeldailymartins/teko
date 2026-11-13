import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import { FONT_VARIABLES_CLASS_NAME } from '@/components/ui/fonts'
import { SkipLink } from '@/components/ui/skip-link'
import { ThemeScript } from '@/components/ui/theme-script'
import { openGraphAlternateLocales, openGraphLocale, routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID, PRODUCT_NAME, SITE_ORIGIN } from '@/lib/site'

interface LocaleLayoutProps {
  readonly children: ReactNode
  readonly params: Promise<{ locale: string }>
}

/** Um HTML por locale no export estático. */
export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: Pick<LocaleLayoutProps, 'params'>): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    return {}
  }
  const t = await getTranslations({ locale, namespace: 'app' })
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { default: `${PRODUCT_NAME} — ${t('tagline')}`, template: `%s · ${PRODUCT_NAME}` },
    description: t('description'),
    applicationName: PRODUCT_NAME,
    openGraph: {
      type: 'website',
      siteName: PRODUCT_NAME,
      locale: openGraphLocale(locale),
      alternateLocale: openGraphAlternateLocales(locale),
    },
    formatDetection: { telephone: false, email: false, address: false },
  }
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfdfd' },
    { media: '(prefers-color-scheme: dark)', color: '#0f171b' },
  ],
}

export async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'common' })

  return (
    <html lang={locale} className={FONT_VARIABLES_CLASS_NAME} suppressHydrationWarning>
      <body>
        <ThemeScript />
        <SkipLink targetId={MAIN_CONTENT_ID}>{t('skipToContent')}</SkipLink>
        {children}
      </body>
    </html>
  )
}
