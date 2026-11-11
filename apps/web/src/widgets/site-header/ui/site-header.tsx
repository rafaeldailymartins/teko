import type { Locale } from '@teko/shared/i18n'
import { getTranslations } from 'next-intl/server'
import { alternateLocales, LOCALE_ENDONYMS, localeHomePath } from '@/shared/i18n'

interface SiteHeaderProps {
  readonly locale: Locale
}

/**
 * Cabeçalho público: marca (link para a inicial do locale) e troca de idioma. A troca é um link
 * comum: muda o `<html lang>` e o layout raiz, então a navegação completa é o comportamento certo.
 */
export async function SiteHeader({ locale }: SiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'common' })
  const appName = (await getTranslations({ locale, namespace: 'app' }))('name')

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <a
          href={localeHomePath(locale)}
          aria-label={t('homeLink')}
          className="rounded-md font-semibold font-serif text-2xl tracking-tight"
        >
          {appName}
        </a>
        <nav aria-label={t('languageNav')}>
          <ul className="flex items-center gap-1">
            {alternateLocales(locale).map((target) => (
              <li key={target}>
                <a
                  href={localeHomePath(target)}
                  hrefLang={target}
                  lang={target}
                  className="inline-flex min-h-9 items-center rounded-md px-3 font-medium text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
                >
                  {LOCALE_ENDONYMS[target]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  )
}
