import { getTranslations } from 'next-intl/server'
import { CoverageView } from '@/components/coverage/coverage-view'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

/**
 * Página de cobertura (`/[locale]/coverage/`): pública, fora do grupo `(app)` e sem sessão, com o
 * cabeçalho e o rodapé do site. O título e a introdução vão no HTML estático; a lista por família
 * vem de `GET /api/v1/coverage` no navegador (`CoverageView`).
 */
export async function CoveragePage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages.coverage' })
  const tCoverage = await getTranslations({ locale, namespace: 'coverage' })
  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-10 sm:py-14">
          <header className="flex flex-col gap-3">
            <h1 className="font-semibold font-serif text-3xl tracking-tight">{t('title')}</h1>
            <p className="text-pretty text-muted-foreground leading-relaxed">
              {tCoverage('intro')}
            </p>
          </header>
          <CoverageView />
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}

export const generateCoverageMetadata = pageMetadata('coverage')
