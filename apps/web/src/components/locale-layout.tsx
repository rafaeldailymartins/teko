import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import { Providers } from '@/components/providers'
import { FONT_VARIABLES_CLASS_NAME } from '@/components/ui/fonts'
import { SkipLink } from '@/components/ui/skip-link'
import { ThemeScript } from '@/components/ui/theme-script'
import { clientMessages, loadMessages } from '@/lib/i18n/messages'
import { openGraphAlternateLocales, openGraphLocale, routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID, PRODUCT_NAME, SITE_ICONS, SITE_ORIGIN } from '@/lib/site'

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
    icons: SITE_ICONS,
    openGraph: {
      type: 'website',
      siteName: PRODUCT_NAME,
      locale: openGraphLocale(locale),
      alternateLocale: openGraphAlternateLocales(locale),
      images: [{ ...OPEN_GRAPH_IMAGE, alt: t('ogImageAlt') }],
    },
    twitter: { card: 'summary_large_image', images: [OPEN_GRAPH_IMAGE.url] },
    formatDetection: { telephone: false, email: false, address: false },
  }
}

/** Imagem do Open Graph (`public/og.png`, gerada da logo por `scripts/brand-assets.ts`). */
const OPEN_GRAPH_IMAGE = { url: '/og.png', width: 1200, height: 630 } as const

/** `theme-color` igual ao `--background` de cada tema (`globals.css`), em hex para os navegadores. */
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7fcfc' },
    { media: '(prefers-color-scheme: dark)', color: '#021a1f' },
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
        {/*
          Herda locale e fuso do `i18n/request.ts`. As mensagens vão sem os namespaces só de
          servidor (texto legal e "Sobre"), que não precisam ir no HTML de toda página.
        */}
        <NextIntlClientProvider messages={clientMessages(await loadMessages(locale))}>
          <Providers>
            {/* Contexto de empilhamento próprio: os popups do Base UI (portais) ficam por cima. */}
            <div className="isolate">{children}</div>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
