import type { Locale } from '@teko/shared/i18n'
import { PRIVACY_POLICY_VERSION, TERMS_VERSION } from '@teko/shared/legal'
import { ArrowUpIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { TekoLogo } from '@/components/brand/teko-logo'
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
  /** Sobretítulo ("Documento legal", "O projeto"). */
  readonly eyebrow: string
  readonly title: string
  readonly lead: ReactNode
  /** Linha de versão e data (páginas legais); o "Sobre" não tem. */
  readonly meta?: string
  /** Marca de cada seção: `§ 1` nos textos legais, `01` no "Sobre". */
  readonly marker: (index: number) => string
  /** Selo da logo no cabeçalho (o "Sobre"). */
  readonly seal?: boolean
  readonly sections: readonly DocumentSection[]
}

/**
 * Página de texto longo, em tipografia editorial: cabeçalho com sobretítulo, título em serif, a
 * versão com o ponto âmbar da data e o lead; no desktop, o sumário fixo à esquerda como uma linha do
 * tempo vertical (no celular, antes do texto); as seções em Source Serif, na largura de leitura,
 * cada uma com a sua marca. O texto vem do catálogo sem mudança: aqui só muda a apresentação.
 */
async function LongDocument({
  locale,
  eyebrow,
  title,
  lead,
  meta,
  marker,
  seal = false,
  sections,
}: LongDocumentProps) {
  const t = await getTranslations({ locale, namespace: 'legal' })
  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <header className="relative isolate overflow-hidden border-b bg-surface-gradient">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-brand-glow" />
          <div className="mx-auto flex max-w-5xl items-start justify-between gap-10 px-5 pt-14 pb-12 sm:pt-20 sm:pb-16">
            <div className="flex max-w-3xl flex-col gap-5">
              <p className="flex items-center gap-3 font-medium font-mono text-primary text-xs uppercase tracking-[0.16em]">
                <span aria-hidden="true" className="h-px w-8 bg-leaf" />
                {eyebrow}
              </p>
              <h1 className="text-balance font-semibold font-serif text-[2.5rem] leading-[1.08] tracking-tight sm:text-[3.4rem]">
                {title}
              </h1>
              {meta === undefined ? null : (
                <p
                  className="inline-flex w-fit items-center gap-2 rounded-full border bg-popover px-3 py-1 font-mono text-muted-foreground text-xs tabular-nums shadow-soft"
                  data-testid="document-version"
                >
                  <span aria-hidden="true" className="size-2 rounded-full bg-date-mark" />
                  {meta}
                </p>
              )}
              <div className="max-w-2xl text-pretty font-serif text-muted-foreground text-xl leading-relaxed [&_a]:text-primary">
                {lead}
              </div>
            </div>
            {seal ? (
              <TekoLogo
                variant="seal"
                className="hidden size-36 rotate-[-4deg] rounded-[2.2rem] shadow-overlay md:block"
              />
            ) : null}
          </div>
        </header>
        <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 sm:py-16 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
          <div className="rounded-xl border bg-surface p-5 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)] lg:self-start lg:overflow-y-auto lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0">
            <nav aria-labelledby="document-toc">
              <h2
                id="document-toc"
                className="font-medium font-mono text-muted-foreground text-xs uppercase tracking-[0.14em]"
              >
                {t('toc')}
              </h2>
              <ol className="relative mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-1 lg:gap-y-0.5 lg:border-l lg:border-border">
                {sections.map((section, index) => (
                  <li key={section.id} className="flex items-baseline gap-2.5 lg:-ml-px">
                    <span
                      aria-hidden="true"
                      className="w-7 shrink-0 font-mono text-muted-foreground text-xs tabular-nums lg:hidden"
                    >
                      {marker(index)}
                    </span>
                    <a
                      href={`#${section.id}`}
                      className="inline-flex min-h-7 items-center rounded-sm text-muted-foreground leading-snug underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline lg:border-transparent lg:border-l-2 lg:pl-4 lg:hover:border-leaf lg:hover:no-underline"
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <a
              href={`#${MAIN_CONTENT_ID}`}
              className="mt-6 hidden min-h-6 items-center gap-1.5 rounded-sm font-medium text-primary text-xs underline-offset-4 hover:underline lg:inline-flex"
            >
              <ArrowUpIcon aria-hidden="true" className="size-3.5" />
              {t('backToTop')}
            </a>
          </div>
          <article className="min-w-0 max-w-[68ch]">
            {sections.map((section, index) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-24 border-b border-border/70 py-9 first:pt-0 last:border-b-0"
              >
                <p
                  aria-hidden="true"
                  className="mb-2 font-mono text-primary text-xs tabular-nums tracking-[0.12em]"
                >
                  {marker(index)}
                </p>
                <h2
                  id={`${section.id}-title`}
                  className="text-balance font-semibold font-serif text-[1.75rem] leading-tight tracking-tight"
                >
                  {section.title}
                </h2>
                <div className="mt-4 flex flex-col gap-4 font-serif text-[1.125rem] text-foreground/90 leading-[1.75]">
                  {section.body}
                </div>
              </section>
            ))}
          </article>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

/** `§ 1`, `§ 2`… nos textos legais. */
const legalMarker = (index: number) => `§ ${index + 1}`
/** `01`, `02`… no "Sobre". */
const aboutMarker = (index: number) => String(index + 1).padStart(2, '0')

export async function PrivacyPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'legal' })
  const tags = richTags(locale)
  return (
    <LongDocument
      locale={locale}
      eyebrow={t('eyebrow')}
      marker={legalMarker}
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
      eyebrow={t('eyebrow')}
      marker={legalMarker}
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
      eyebrow={t('eyebrow')}
      marker={aboutMarker}
      seal
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
