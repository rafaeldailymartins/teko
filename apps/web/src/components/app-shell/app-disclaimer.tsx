'use client'

import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { localePagePath } from '@/lib/navigation'

/**
 * Aviso de que o Tekó não constitui parecer, numa linha pequena no fim do conteúdo das páginas do
 * app. No chat ele fica logo abaixo do composer (sempre à vista), então aqui não se repete.
 */
export function AppDisclaimer() {
  const t = useTranslations('common')
  const locale = useLocale()
  const pathname = usePathname()
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`
  if (path === localePagePath(locale, 'chat')) return null
  return (
    <footer className="mt-auto px-4 pt-10 pb-5 text-center text-muted-foreground text-xs">
      <p>{t('disclaimer')}</p>
    </footer>
  )
}
