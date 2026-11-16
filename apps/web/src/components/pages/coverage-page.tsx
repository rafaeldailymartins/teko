import { getTranslations } from 'next-intl/server'
import { CoverageView } from '@/components/coverage/coverage-view'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

/**
 * Página de cobertura (`/[locale]/coverage/`): pública, fora do grupo `(app)` e sem sessão, com o
 * cabeçalho e o rodapé do site. O cabeçalho editorial (sobretítulo, título e introdução) vai no
 * HTML estático; a lista por família vem de `GET /api/v1/coverage` no navegador (`CoverageView`).
 */
export async function CoveragePage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.coverage' })
  const tCoverage = await getTranslations({ locale, namespace: 'coverage' })
  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <header className="relative isolate overflow-hidden border-b bg-surface-gradient">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-brand-glow" />
          <div className="mx-auto flex max-w-5xl flex-col gap-5 px-5 pt-14 pb-12 sm:pt-20 sm:pb-16">
            <p className="flex items-center gap-3 font-medium font-mono text-primary text-xs uppercase tracking-[0.16em]">
              <span aria-hidden="true" className="h-px w-8 bg-leaf" />
              {tCoverage('eyebrow')}
            </p>
            <h1 className="font-semibold font-serif text-[2.5rem] leading-[1.08] tracking-tight sm:text-[3.4rem]">
              {t('title')}
            </h1>
            <p className="max-w-2xl text-pretty font-serif text-muted-foreground text-xl leading-relaxed">
              {tCoverage('intro')}
            </p>
          </div>
        </header>
        <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:py-16">
          <CoverageView />
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

export const generateCoverageMetadata = pageMetadata('coverage')
