import type { Locale } from '@teko/shared/i18n'
import { ArrowLeftIcon } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath, routing } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'
import { MAIN_CONTENT_ID } from '@/lib/site'

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
 *   que a rota de 404 do `config.json` da Vercel serve para caminhos inexistentes do locale;
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
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="relative isolate flex min-h-[72dvh] items-center overflow-hidden focus:outline-none"
      >
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-brand-glow" />
        <div className="mx-auto grid w-full max-w-5xl items-center gap-14 px-5 py-20 sm:py-28 md:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-5">
            <p className="flex items-center gap-3 font-medium font-mono text-primary text-xs uppercase tracking-[0.16em]">
              <span aria-hidden="true" className="h-px w-8 bg-leaf" />
              {t('eyebrow')}
            </p>
            <h1 className="text-balance font-semibold font-serif text-[2.5rem] leading-[1.08] tracking-tight sm:text-[3.4rem]">
              {t('title')}
            </h1>
            <p className="max-w-md text-lg text-muted-foreground leading-relaxed">
              {t('description')}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href={localeHomePath(locale)}
                className={buttonVariants({ variant: 'brand', size: 'lg' })}
              >
                <ArrowLeftIcon aria-hidden="true" />
                {t('backHome')}
              </a>
              <a
                href={localePagePath(locale, 'coverage')}
                className={buttonVariants({ variant: 'outline', size: 'lg' })}
              >
                {t('coverage')}
              </a>
            </div>
          </div>
          <figure aria-hidden="true" className="flex flex-col items-center gap-8">
            {/* Número decorativo em SVG (o título já diz que a página não existe). */}
            <svg
              aria-hidden="true"
              viewBox="0 0 320 120"
              className="w-64 text-primary/20 sm:w-80"
              focusable="false"
            >
              <text
                x="160"
                y="100"
                textAnchor="middle"
                fill="currentColor"
                className="font-mono font-semibold"
                fontSize="128"
                letterSpacing="-4"
              >
                404
              </text>
            </svg>
            <div className="relative h-px w-full max-w-xs timeline-rule">
              <span className="absolute top-1/2 left-[22%] size-2.5 -translate-y-1/2 rounded-full border-2 border-leaf bg-background" />
              <span className="absolute top-1/2 left-[52%] size-2.5 -translate-y-1/2 rounded-full border-2 border-leaf bg-background" />
              <span className="absolute top-1/2 left-[78%] size-2.5 -translate-y-1/2 rounded-full border-2 border-border-strong bg-background" />
              <span className="absolute -top-9 left-[64%] size-4 rounded-full border-[3px] border-background bg-date-mark shadow-[0_0_0_6px_color-mix(in_oklch,var(--date-mark)_22%,transparent)]" />
              <span className="absolute -top-5 left-[calc(64%+0.45rem)] h-4 w-px border-date-mark border-l border-dashed" />
            </div>
            <figcaption className="text-muted-foreground text-sm">{t('timeline')}</figcaption>
          </figure>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
