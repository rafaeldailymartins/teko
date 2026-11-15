import type { Locale } from '@teko/shared/i18n'
import { getTranslations } from 'next-intl/server'
import { LanguageSwitch } from '@/components/language-switch'
import { ThemeSelector } from '@/components/theme-selector'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'

interface SiteHeaderProps {
  readonly locale: Locale
}

/** Cabeçalho público: marca (link para a inicial do locale), entrada no app, idioma e tema. */
export async function SiteHeader({ locale }: SiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'common' })
  const appName = (await getTranslations({ locale, namespace: 'app' }))('name')

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-5 py-3">
        <a
          href={localeHomePath(locale)}
          aria-label={t('homeLink')}
          className="rounded-md font-semibold font-serif text-2xl tracking-tight"
        >
          {appName}
        </a>
        <div className="flex items-center gap-1 sm:gap-2">
          <a
            href={localePagePath(locale, 'chat')}
            className={buttonVariants({ size: 'sm', className: 'max-sm:hidden' })}
          >
            {t('openApp')}
          </a>
          <LanguageSwitch />
          <ThemeSelector />
        </div>
      </div>
    </header>
  )
}
