import type { Locale } from '@teko/shared/i18n'
import { localeHomePath, routing } from '@/shared/i18n'

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
            className="inline-flex min-h-10 items-center rounded-md border border-border-strong px-5 font-medium hover:bg-surface"
          >
            {labels[locale]}
          </a>
        </li>
      ))}
    </ul>
  )
}
