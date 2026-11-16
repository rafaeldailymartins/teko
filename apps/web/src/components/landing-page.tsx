import type { Metadata } from 'next'
import { hasLocale } from 'next-intl'
import { Hero } from '@/components/landing/hero'
import { Corpus, Faq, FinalCta, Guarantees, HowItWorks } from '@/components/landing/sections'
import { type LocalePageProps, resolvePageLocale } from '@/components/pages/page-route'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { languageAlternates, localeHomePath, routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID } from '@/lib/site'

export async function generateLandingMetadata({ params }: LocalePageProps): Promise<Metadata> {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    return {}
  }
  return {
    alternates: { canonical: localeHomePath(locale), languages: languageAlternates() },
  }
}

/**
 * Landing estática (SSG), sem nenhuma chamada à API: o hero com a demonstração animada do chat (o
 * único componente de cliente da página, que no HTML estático mostra o quadro final), "Como
 * funciona" em linha do tempo, o corpus numa régua, as garantias, o FAQ em `<details>` e a faixa
 * final de chamada.
 */
export async function LandingPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)

  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <Hero locale={locale} />
        <HowItWorks locale={locale} />
        <Corpus locale={locale} />
        <Guarantees locale={locale} />
        <Faq locale={locale} />
        <FinalCta locale={locale} />
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
