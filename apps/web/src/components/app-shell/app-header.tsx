'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { UserMenu } from '@/components/auth/user-menu'
import { LanguageSwitch } from '@/components/language-switch'
import { ThemeSelector } from '@/components/theme-selector'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { CommandPalette } from './command-palette.tsx'
import { PAGE_ICONS } from './page-icons.ts'

/** Destinos fixos do cabeçalho; as demais páginas ficam na paleta e no rodapé do site. */
const HEADER_PAGES = ['chat', 'history', 'coverage', 'settings'] as const

/** Garante a barra final, para comparar com os caminhos de `trailingSlash: true`. */
function withTrailingSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

/**
 * Cabeçalho do app shell: marca, navegação principal (a partir de 768 px), paleta de comandos,
 * idioma, tema e a sessão (entrar ou o menu da conta). No celular a navegação fica na paleta, que tem botão visível.
 */
export function AppHeader() {
  const locale = useLocale()
  const pathname = withTrailingSlash(usePathname())
  const t = useTranslations('shell')
  const tCommon = useTranslations('common')
  const tPages = useTranslations('pages')
  const tApp = useTranslations('app')

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <Link
        href={localeHomePath(locale)}
        aria-label={tCommon('homeLink')}
        className="rounded-md px-1 font-semibold font-serif text-xl tracking-tight"
      >
        {tApp('name')}
      </Link>
      <nav aria-label={t('mainNav')} className="ml-3 hidden md:block">
        <ul className="flex items-center gap-1">
          {HEADER_PAGES.map((page) => {
            const href = localePagePath(locale, page)
            const current = pathname === href
            const Icon = PAGE_ICONS[page]
            return (
              <li key={page}>
                <Link
                  href={href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground text-sm hover:bg-muted hover:text-foreground [&_svg]:size-4',
                    current && 'bg-muted text-foreground',
                  )}
                >
                  <Icon aria-hidden="true" />
                  {tPages(`${page}.title`)}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="ml-auto flex items-center gap-1">
        <CommandPalette />
        <LanguageSwitch />
        <ThemeSelector />
        <UserMenu />
      </div>
    </header>
  )
}
