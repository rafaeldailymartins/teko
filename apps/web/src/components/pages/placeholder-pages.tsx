import { BookOpenTextIcon, GitCompareArrowsIcon, type LucideIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { PAGE_ICONS } from '@/components/app-shell/page-icons'
import { EmptyState } from '@/components/empty-state'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { isAppPage, type Page } from '@/lib/navigation'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

type PlaceholderPage = Exclude<Page, 'chat' | 'settings' | 'sign-in'>

const ICONS: Readonly<Record<PlaceholderPage, LucideIcon>> = {
  history: PAGE_ICONS.history,
  coverage: PAGE_ICONS.coverage,
  about: PAGE_ICONS.about,
  privacy: PAGE_ICONS.privacy,
  terms: PAGE_ICONS.terms,
  provision: BookOpenTextIcon,
  compare: GitCompareArrowsIcon,
}

interface PlaceholderPageViewProps extends LocalePageProps {
  readonly page: PlaceholderPage
}

/**
 * Página-esqueleto: título e estado vazio, estática e sem chamada à API. As próximas etapas da F5
 * trocam o conteúdo de cada uma (histórico, cobertura, páginas legais...).
 * As do app shell ficam só com o conteúdo (o layout do grupo `(app)` põe cabeçalho, `<main>` e
 * aviso); as públicas trazem o cabeçalho e o rodapé do site, como a landing.
 */
async function PlaceholderPageView({ page, params }: PlaceholderPageViewProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages' })
  const Icon = ICONS[page]
  const content: ReactNode = (
    <div className="mx-auto w-full max-w-3xl px-5 py-10 sm:py-14">
      <h1 className="font-semibold font-serif text-3xl tracking-tight">{t(`${page}.title`)}</h1>
      <EmptyState
        icon={<Icon />}
        title={t(`${page}.emptyTitle`)}
        className="mt-8 rounded-xl border border-dashed bg-surface"
      >
        {t(`${page}.emptyBody`)}
      </EmptyState>
    </div>
  )

  if (isAppPage(page)) {
    return content
  }
  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        {content}
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

export function HistoryPage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="history" params={params} />
}
export const generateHistoryMetadata = pageMetadata('history')

export function ProvisionPage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="provision" params={params} />
}
export const generateProvisionMetadata = pageMetadata('provision')

export function ComparePage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="compare" params={params} />
}
export const generateCompareMetadata = pageMetadata('compare')

export function CoveragePage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="coverage" params={params} />
}
export const generateCoverageMetadata = pageMetadata('coverage')

export function AboutPage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="about" params={params} />
}
export const generateAboutMetadata = pageMetadata('about')

export function PrivacyPage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="privacy" params={params} />
}
export const generatePrivacyMetadata = pageMetadata('privacy')

export function TermsPage({ params }: LocalePageProps) {
  return <PlaceholderPageView page="terms" params={params} />
}
export const generateTermsMetadata = pageMetadata('terms')
