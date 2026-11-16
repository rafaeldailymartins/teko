import type { Locale } from '@teko/shared/i18n'
import { getTranslations } from 'next-intl/server'
import { ConsentPreferencesButton } from '@/components/consent/consent-provider'
import { localePagePath } from '@/lib/navigation'
import { REPOSITORY_URL } from '@/lib/site'

interface SiteFooterProps {
  readonly locale: Locale
}

/** Páginas institucionais do rodapé, na ordem em que aparecem. */
const FOOTER_PAGES = ['coverage', 'about', 'privacy', 'terms'] as const

/** Rodapé público com o aviso fixo de que o Tekó não substitui parecer profissional. */
export async function SiteFooter({ locale }: SiteFooterProps) {
  const t = await getTranslations({ locale, namespace: 'common' })
  const tPages = await getTranslations({ locale, namespace: 'pages' })

  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-5 py-8 text-muted-foreground text-sm">
        <p className="font-medium text-foreground">{t('disclaimer')}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {FOOTER_PAGES.map((page) => (
              <li key={page}>
                <a
                  href={localePagePath(locale, page)}
                  className="inline-flex min-h-6 items-center underline-offset-4 hover:text-foreground hover:underline"
                >
                  {tPages(`${page}.title`)}
                </a>
              </li>
            ))}
            <li>
              <ConsentPreferencesButton className="inline-flex min-h-[24px] cursor-pointer items-center underline-offset-4 hover:text-foreground hover:underline" />
            </li>
          </ul>
          <p>
            {t('license')}{' '}
            <a
              href={REPOSITORY_URL}
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              {t('sourceCode')}
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
