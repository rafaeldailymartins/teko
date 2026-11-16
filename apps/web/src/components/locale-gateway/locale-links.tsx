import type { Locale } from '@teko/shared/i18n'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath, routing } from '@/lib/i18n/routing'

interface LocaleLinksProps {
  readonly labels: Readonly<Record<Locale, string>>
}

/** Um link por locale, cada um no próprio idioma. */
export function LocaleLinks({ labels }: LocaleLinksProps) {
  return (
    <ul className="flex flex-col gap-3 sm:flex-row">
      {routing.locales.map((locale) => (
        <li key={locale}>
          <a
            href={localeHomePath(locale)}
            hrefLang={locale}
            lang={locale}
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            {labels[locale]}
          </a>
        </li>
      ))}
    </ul>
  )
}
