import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { SignInPanel } from '@/components/auth/sign-in-panel'
import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { type LocalePageProps, pageMetadata, resolvePageLocale } from './page-route.ts'

export const generateSignInMetadata = pageMetadata('sign-in')

/**
 * Página de entrada (site público). O painel lê a query (`callbackURL`, `error`), então fica num
 * `<Suspense>`: o HTML estático sai com o título e o painel entra na hidratação.
 */
export async function SignInPage({ params }: LocalePageProps) {
  const locale = await resolvePageLocale(params)
  const t = await getTranslations({ locale, namespace: 'pages' })
  const title = t('sign-in.title')

  return (
    <>
      <SiteHeader locale={locale} />
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="focus:outline-none">
        <div className="mx-auto w-full max-w-md px-5 py-10 sm:py-16">
          <Suspense
            fallback={<h1 className="font-semibold font-serif text-3xl tracking-tight">{title}</h1>}
          >
            <SignInPanel title={title} />
          </Suspense>
        </div>
      </main>
      <SiteFooter locale={locale} />
    </>
  )
}
