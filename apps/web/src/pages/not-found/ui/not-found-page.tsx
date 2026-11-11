import type { Locale } from '@teko/shared/i18n'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server'
import { MAIN_CONTENT_ID } from '@/shared/config'
import { localeHomePath, routing } from '@/shared/i18n'
import { SiteFooter } from '@/widgets/site-footer'
import { SiteHeader } from '@/widgets/site-header'

interface NotFoundPageProps {
  /** Presente quando renderizada como página (`[...rest]`); ausente no boundary `not-found`. */
  readonly params?: Promise<{ locale: string }>
}

async function resolveLocale(params: NotFoundPageProps['params']): Promise<Locale> {
  if (!params) {
    return getLocale()
  }
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  return locale
}

export async function generateNotFoundMetadata({ params }: NotFoundPageProps): Promise<Metadata> {
  const locale = await resolveLocale(params)
  const t = await getTranslations({ locale, namespace: 'notFound' })
  return { title: t('title'), robots: { index: false, follow: true } }
}

/**
 * 404 dentro de um locale, em duas portas de entrada:
 * - como página em `[...rest]`, gerando `/<locale>/404/index.html` completo no export estático,
 *   que o `_redirects` da Netlify serve com status 404 para caminhos inexistentes do locale;
 * - como boundary `not-found` do segmento `[locale]`, para `notFound()` em navegação no cliente.
 *
 * Chamar `notFound()` no prerender geraria só a casca `__next_error__`, sem conteúdo sem JS.
 */
export async function NotFoundPage({ params }: NotFoundPageProps = {}) {
  const locale = await resolveLocale(params)
  const t = await getTranslations({ locale, namespace: 'notFound' })

  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <div className="mx-auto max-w-5xl px-5 py-24">
          <p className="font-medium text-muted-foreground text-sm">404</p>
          <h1 className="mt-2 font-semibold font-serif text-4xl tracking-tight">{t('title')}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{t('description')}</p>
          <a
            href={localeHomePath(locale)}
            className="mt-8 inline-flex min-h-10 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground hover:bg-primary/90"
          >
            {t('backHome')}
          </a>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
