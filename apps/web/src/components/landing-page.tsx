import type { Locale } from '@teko/shared/i18n'
import {
  BookOpenCheckIcon,
  CalendarClockIcon,
  CodeIcon,
  type LucideIcon,
  QuoteIcon,
  ScaleIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  UserCheckIcon,
} from 'lucide-react'
import type { Metadata } from 'next'
import { hasLocale } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { type LocalePageProps, resolvePageLocale } from '@/components/pages/page-route'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { languageAlternates, localeHomePath, routing } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'
import { MAIN_CONTENT_ID } from '@/lib/site'

const STEPS: readonly (readonly ['referenceDate' | 'citations' | 'coverage', LucideIcon])[] = [
  ['referenceDate', CalendarClockIcon],
  ['citations', QuoteIcon],
  ['coverage', ScaleIcon],
]

const CORPUS = ['efdIcmsIpi', 'efdReinf', 'rcte', 'cte', 'efdGo'] as const

const GUARANTEES: readonly (readonly [
  'sources' | 'refusal' | 'advice' | 'openSource',
  LucideIcon,
])[] = [
  ['sources', BookOpenCheckIcon],
  ['refusal', ShieldAlertIcon],
  ['advice', UserCheckIcon],
  ['openSource', CodeIcon],
]

const FAQ = ['advice', 'referenceDate', 'cost', 'data'] as const

const SECTION_TITLE = 'font-semibold font-serif text-2xl tracking-tight sm:text-3xl'

export async function generateLandingMetadata({ params }: LocalePageProps): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    return {}
  }
  return {
    alternates: { canonical: localeHomePath(locale), languages: languageAlternates() },
  }
}

/** Landing estática (SSG), sem nenhuma chamada à API nem JavaScript próprio. */
export async function LandingPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'landing' })

  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <section
          aria-labelledby="hero-title"
          className="mx-auto grid max-w-5xl gap-12 px-5 pt-14 pb-16 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center"
        >
          <div>
            <Badge tone="accent">
              <span aria-hidden="true" className="size-2 rounded-full bg-accent-border" />
              {t('status')}
            </Badge>
            <h1
              id="hero-title"
              className="mt-6 text-balance font-semibold font-serif text-4xl leading-tight tracking-tight sm:text-5xl"
            >
              {t('title')}
            </h1>
            <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground leading-relaxed">
              {t('lead')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={localePagePath(locale, 'chat')} className={buttonVariants({ size: 'lg' })}>
                {t('cta.ask')}
              </a>
              <a
                href={localePagePath(locale, 'coverage')}
                className={buttonVariants({ size: 'lg', variant: 'outline' })}
              >
                {t('cta.coverage')}
              </a>
            </div>
          </div>
          <HeroDemo locale={locale} />
        </section>

        <section aria-labelledby="how-it-works-title" className="border-t bg-surface">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 id="how-it-works-title" className={SECTION_TITLE}>
              {t('howItWorks.title')}
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map(([step, Icon], index) => (
                <li key={step} className="rounded-xl border bg-background p-6 shadow-xs">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="flex size-9 items-center justify-center rounded-full bg-muted text-primary [&_svg]:size-5"
                    >
                      <Icon />
                    </span>
                    <span aria-hidden="true" className="font-mono text-muted-foreground text-sm">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold text-base">{t(`howItWorks.${step}.title`)}</h3>
                  <p className="mt-2 text-muted-foreground leading-relaxed">
                    {t(`howItWorks.${step}.body`)}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="corpus-title" className="mx-auto max-w-5xl px-5 py-14">
          <h2 id="corpus-title" className={SECTION_TITLE}>
            {t('corpus.title')}
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground leading-relaxed">{t('corpus.lead')}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CORPUS.map((family) => (
              <li key={family} className="rounded-xl border p-5">
                <p className="font-semibold">{t(`corpus.${family}.name`)}</p>
                <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                  {t(`corpus.${family}.body`)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="guarantees-title" className="border-t bg-surface">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 id="guarantees-title" className={SECTION_TITLE}>
              {t('guarantees.title')}
            </h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2">
              {GUARANTEES.map(([guarantee, Icon]) => (
                <li key={guarantee} className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary ring-1 ring-border [&_svg]:size-5"
                  >
                    <Icon />
                  </span>
                  <div>
                    <h3 className="font-semibold">{t(`guarantees.${guarantee}.title`)}</h3>
                    <p className="mt-1 text-muted-foreground leading-relaxed">
                      {t(`guarantees.${guarantee}.body`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="mx-auto max-w-3xl px-5 py-14">
          <h2 id="faq-title" className={SECTION_TITLE}>
            {t('faq.title')}
          </h2>
          <div className="mt-6 divide-y border-y">
            {FAQ.map((item) => (
              <details key={item} className="group py-4">
                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium [&::-webkit-details-marker]:hidden">
                  {t(`faq.${item}.question`)}
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-muted-foreground leading-relaxed">
                  {t(`faq.${item}.answer`)}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

interface HeroDemoProps {
  readonly locale: Locale
}

/**
 * Demonstração estática de uma resposta: a data de referência em âmbar, a citação numerada e o
 * aviso de que outra data muda a resposta. É ilustrativa: não sai da API.
 */
async function HeroDemo({ locale }: HeroDemoProps) {
  const t = await getTranslations({ locale, namespace: 'landing' })
  return (
    <figure
      aria-label={t('demo.label')}
      className="rounded-2xl border bg-popover p-5 text-popover-foreground shadow-sm sm:p-6"
    >
      <p className="inline-flex items-center gap-2 rounded-full border border-accent-border bg-accent px-3 py-1 font-medium text-accent-foreground text-sm">
        <CalendarClockIcon aria-hidden="true" className="size-4" />
        {t('demo.referenceDate')}
      </p>
      <p className="mt-4 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-primary-foreground">
        {t('demo.question')}
      </p>
      <div className="mt-4 rounded-xl bg-muted p-4">
        <p className="text-[0.9375rem] leading-relaxed">
          {t('demo.answer')}{' '}
          <span className="inline-flex items-center rounded-md border border-border-strong bg-background px-1.5 font-mono text-primary text-xs tabular-nums">
            1
          </span>
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-sm">
          <ShieldCheckIcon aria-hidden="true" className="size-4 text-validity-current" />
          <span className="font-medium">{t('demo.citation')}</span>
          <span className="text-validity-current">{t('demo.citationNote')}</span>
        </p>
      </div>
      <figcaption className="mt-4 text-muted-foreground text-sm leading-relaxed">
        {t('demo.changed')}
      </figcaption>
    </figure>
  )
}
