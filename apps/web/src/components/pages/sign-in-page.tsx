import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { SignInBrandPanel } from '@/components/auth/sign-in-brand-panel'
import { SignInHeading, SignInPanel, SignInSkeleton } from '@/components/auth/sign-in-panel'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { LanguageMenu } from '@/components/language-menu'
import { ThemeSelector } from '@/components/theme-selector'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateSignInMetadata = pageMetadata('sign-in')

/**
 * Página de entrada, em duas colunas no desktop: o painel da marca e o formulário. No celular fica
 * só a coluna do formulário, com a marca no topo. O painel lê a query (`callbackURL`, `error`),
 * então fica num `<Suspense>`: o HTML estático sai com o título e o esqueleto do formulário, do
 * mesmo tamanho, e o painel entra na hidratação.
 */
export async function SignInPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages' })
  const tAuth = await getTranslations({ locale, namespace: 'auth.signIn' })
  const tCommon = await getTranslations({ locale, namespace: 'common' })
  const title = t('sign-in.title')
  const link =
    'rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline'

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <SignInBrandPanel locale={locale} />
      <div className="flex min-h-dvh min-w-0 flex-col bg-brand-glow">
        <header className="flex h-16 items-center gap-3 px-5 sm:px-8">
          <a
            href={localeHomePath(locale)}
            aria-label={tCommon('homeLink')}
            className="-ml-1 rounded-lg px-1 py-1 transition-opacity hover:opacity-85 lg:hidden"
          >
            <TekoWordmark />
          </a>
          <div className="ml-auto flex items-center gap-0.5">
            <LanguageMenu />
            <ThemeSelector />
          </div>
        </header>
        <div aria-hidden="true" className="timeline-rule h-px lg:hidden" />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 justify-center px-5 py-10 focus:outline-none sm:px-8 sm:py-14 lg:items-center"
        >
          <div className="w-full max-w-[26rem]">
            <Suspense
              fallback={
                <div className="flex flex-col gap-7">
                  <SignInHeading title={title} lead={tAuth('lead')} />
                  <SignInSkeleton label={tAuth('loading')} />
                </div>
              }
            >
              <SignInPanel title={title} />
            </Suspense>
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-6 text-muted-foreground text-xs sm:px-8">
          <p>{tCommon('disclaimer')}</p>
          <nav aria-label={tCommon('footer.legal')} className="flex gap-4">
            <a href={localePagePath(locale, 'privacy')} className={link}>
              {t('privacy.title')}
            </a>
            <a href={localePagePath(locale, 'terms')} className={link}>
              {t('terms.title')}
            </a>
          </nav>
        </footer>
      </div>
    </div>
  )
}
