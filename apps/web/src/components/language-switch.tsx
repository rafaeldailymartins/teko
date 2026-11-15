'use client'

import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { alternateLocales, LOCALE_ENDONYMS } from '@/lib/i18n/routing'
import { switchLocalePath } from '@/lib/navigation'

/**
 * Troca de idioma que mantém a página. É um link comum: muda o `<html lang>` e o layout raiz, então
 * a navegação completa é o comportamento certo.
 */
export function LanguageSwitch() {
  const locale = useLocale()
  const pathname = usePathname()
  const t = useTranslations('common')

  return (
    <nav aria-label={t('languageNav')}>
      <ul className="flex items-center gap-1">
        {alternateLocales(locale).map((target) => (
          <li key={target}>
            <a
              href={switchLocalePath(pathname, target)}
              hrefLang={target}
              lang={target}
              className="inline-flex min-h-8 items-center rounded-md px-2.5 font-medium text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            >
              {LOCALE_ENDONYMS[target]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
