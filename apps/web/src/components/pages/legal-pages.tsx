import type { Locale } from '@teko/shared/i18n'
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@teko/shared/legal'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { formatIsoDate } from '@/lib/i18n/format'
import {
  ABOUT_SECTIONS,
  type LegalRichTag,
  PRIVACY_SECTIONS,
  sectionAnchor,
  TERMS_SECTIONS,
} from '@/lib/legal-documents'
import { localePagePath } from '@/lib/navigation'
import { MAIN_CONTENT_ID, REPOSITORY_URL } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

/** Relato privado do GitHub (o mesmo canal do `SECURITY.md`). */
const PRIVATE_REPORT_URL = `${REPOSITORY_URL}/security/advisories/new`
const SECURITY_POLICY_URL = `${REPOSITORY_URL}/blob/main/SECURITY.md`
const ISSUES_URL = `${REPOSITORY_URL}/issues`
const CONTRIBUTING_URL = `${REPOSITORY_URL}/blob/main/CONTRIBUTING.md`
const LICENSE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`
const ANPD_URL = 'https://www.gov.br/anpd'

type RichTag = (chunks: ReactNode) => ReactNode

function externalLink(href: string): RichTag {
  return (chunks) => (
    <a
      href={href}
      rel="noopener noreferrer"
      className="text-primary underline underline-offset-4 hover:text-foreground"
    >
      {chunks}
    </a>
  )
}

function internalLink(href: string): RichTag {
  return (chunks) => (
    <a href={href} className="text-primary underline underline-offset-4 hover:text-foreground">
      {chunks}
    </a>
  )
}

/**
 * Tags de rich text dos textos longos. Os blocos (`<p>`, `<ul>`, `<li>`) ficam no catálogo para o
 * tradutor controlar a estrutura; `<ptBR>` marca um termo em português (nome de lei, de órgão)
 * com `lang="pt-BR"`, que também vale na página em inglês (WCAG 3.1.2).
 */
function richTags(locale: Locale): Record<LegalRichTag, RichTag> {
  return {
    p: (chunks) => <p>{chunks}</p>,
    ul: (chunks) => (
      <ul className="list-disc space-y-1.5 pl-6 marker:text-muted-foreground">{chunks}</ul>
    ),
    li: (chunks) => <li>{chunks}</li>,
    strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
    ptBR: (chunks) => <span lang="pt-BR">{chunks}</span>,
    privacy: internalLink(localePagePath(locale, 'privacy')),
    terms: internalLink(localePagePath(locale, 'terms')),
    settings: internalLink(localePagePath(locale, 'settings')),
    coverage: internalLink(localePagePath(locale, 'coverage')),
    about: internalLink(localePagePath(locale, 'about')),
    repo: externalLink(REPOSITORY_URL),
    issues: externalLink(ISSUES_URL),
    privateReport: externalLink(PRIVATE_REPORT_URL),
    security: externalLink(SECURITY_POLICY_URL),
    contributing: externalLink(CONTRIBUTING_URL),
    license: externalLink(LICENSE_URL),
    anpd: externalLink(ANPD_URL),
  }
}

interface DocumentSection {
  readonly id: string
  readonly title: string
  readonly body: ReactNode
}

interface LongDocumentProps {
  readonly locale: Locale
  readonly title: string
  readonly lead: ReactNode
  /** Linha de versão e data (páginas legais); o "Sobre" não tem. */
  readonly meta?: string
  readonly sections: readonly DocumentSection[]
}

/**
 * Página de texto longo: cabeçalho e rodapé do site, título, versão, sumário com âncoras e as
 * seções em Source Serif, com largura de leitura confortável.
 */
async function LongDocument({ locale, title, lead, meta, sections }: LongDocumentProps) {
  const t = await getTranslations({ locale, namespace: 'legal' })
  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <article className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
          <header className="flex flex-col gap-3 border-b pb-8">
            <h1 className="font-semibold font-serif text-3xl tracking-tight sm:text-4xl">
              {title}
            </h1>
            {meta === undefined ? null : (
              <p className="text-muted-foreground text-sm" data-testid="document-version">
                {meta}
              </p>
            )}
            <div className="font-serif text-lg leading-relaxed">{lead}</div>
          </header>
          <nav aria-labelledby="document-toc" className="border-b py-6">
            <h2 id="document-toc" className="font-medium text-muted-foreground text-sm">
              {t('toc')}
            </h2>
            <ol className="mt-3 grid list-decimal gap-x-8 gap-y-1.5 pl-5 text-sm sm:grid-cols-2">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex min-h-6 items-center underline-offset-4 hover:underline"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-title`}
              className="scroll-mt-20 py-6"
            >
              <h2
                id={`${section.id}-title`}
                className="font-semibold font-serif text-2xl tracking-tight"
              >
                {section.title}
              </h2>
              <div className="mt-3 flex flex-col gap-3 font-serif text-[1.0625rem] leading-relaxed">
                {section.body}
              </div>
            </section>
          ))}
        </article>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

export async function PrivacyPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'legal' })
  const tags = richTags(locale)
  return (
    <LongDocument
      locale={locale}
      title={t('privacy.title')}
      lead={t.rich('privacy.lead', tags)}
      meta={t('updated', {
        version: PRIVACY_POLICY_VERSION,
        date: formatIsoDate(locale, PRIVACY_POLICY_VERSION),
      })}
      sections={PRIVACY_SECTIONS.map((id) => ({
        id: sectionAnchor(id),
        title: t(`privacy.sections.${id}.title`),
        body: t.rich(`privacy.sections.${id}.body`, tags),
      }))}
    />
  )
}
export const generatePrivacyMetadata = pageMetadata('privacy')

export async function TermsPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'legal' })
  const tags = richTags(locale)
  return (
    <LongDocument
      locale={locale}
      title={t('terms.title')}
      lead={t.rich('terms.lead', tags)}
      meta={t('inForce', { version: TERMS_VERSION, date: formatIsoDate(locale, TERMS_VERSION) })}
      sections={TERMS_SECTIONS.map((id) => ({
        id: sectionAnchor(id),
        title: t(`terms.sections.${id}.title`),
        body: t.rich(`terms.sections.${id}.body`, tags),
      }))}
    />
  )
}
export const generateTermsMetadata = pageMetadata('terms')

export async function AboutPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'about' })
  const tags = richTags(locale)
  return (
    <LongDocument
      locale={locale}
      title={t('title')}
      lead={t.rich('lead', tags)}
      sections={ABOUT_SECTIONS.map((id) => ({
        id: sectionAnchor(id),
        title: t(`sections.${id}.title`),
        body: t.rich(`sections.${id}.body`, tags),
      }))}
    />
  )
}
export const generateAboutMetadata = pageMetadata('about')
