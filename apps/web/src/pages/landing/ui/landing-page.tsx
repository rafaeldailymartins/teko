import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { MAIN_CONTENT_ID } from '@/shared/config'
import { languageAlternates, localeHomePath, routing } from '@/shared/i18n'
import { Badge } from '@/shared/ui'
import { SiteFooter } from '@/widgets/site-footer'
import { SiteHeader } from '@/widgets/site-header'

interface LandingPageProps {
  readonly params: Promise<{ locale: string }>
}

const FEATURES = ['referenceDate', 'citations', 'coverage'] as const

export async function generateLandingMetadata({ params }: LandingPageProps): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    return {}
  }
  return {
    alternates: { canonical: localeHomePath(locale), languages: languageAlternates() },
  }
}

/** Landing estática (SSG), sem nenhuma chamada à API. */
export async function LandingPage({ params }: LandingPageProps) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'landing' })

  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <section
          aria-labelledby="hero-title"
          className="mx-auto max-w-5xl px-5 pt-16 pb-12 sm:pt-24"
        >
          <Badge tone="accent">
            <span aria-hidden="true" className="size-2 rounded-full bg-accent-border" />
            {t('status')}
          </Badge>
          <h1
            id="hero-title"
            className="mt-6 max-w-3xl text-balance font-semibold font-serif text-4xl leading-tight tracking-tight sm:text-5xl"
          >
            {t('title')}
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </section>

        <section aria-labelledby="how-it-works-title" className="border-border border-t bg-surface">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2
              id="how-it-works-title"
              className="font-semibold font-serif text-2xl tracking-tight"
            >
              {t('howItWorks.title')}
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature}
                  className="rounded-lg border border-border bg-background p-6 shadow-xs"
                >
                  <h3 className="font-semibold text-base">{t(`howItWorks.${feature}.title`)}</h3>
                  <p className="mt-2 text-muted-foreground leading-relaxed">
                    {t(`howItWorks.${feature}.body`)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="project-status-title" className="mx-auto max-w-5xl px-5 py-14">
          <h2
            id="project-status-title"
            className="font-semibold font-serif text-2xl tracking-tight"
          >
            {t('projectStatus.title')}
          </h2>
          <div className="mt-4 max-w-2xl space-y-3 text-muted-foreground leading-relaxed">
            <p>{t('projectStatus.body')}</p>
            <p>{t('projectStatus.scope')}</p>
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
