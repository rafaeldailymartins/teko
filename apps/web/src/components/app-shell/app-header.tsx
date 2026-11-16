'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { UserMenu } from '@/components/auth/user-menu'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { LanguageMenu } from '@/components/language-menu'
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
 * Cabeçalho do app shell: a marca, a navegação principal em abas (a partir de 768 px, a atual em
 * relevo), a busca da paleta de comandos, idioma, tema e a conta. No celular a navegação fica na
 * paleta, que tem botão visível. O fio de baixo é a linha do tempo da logo.
 */
export function AppHeader() {
  const locale = useLocale()
  const pathname = withTrailingSlash(usePathname())
  const t = useTranslations('shell')
  const tCommon = useTranslations('common')
  const tPages = useTranslations('pages')

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 bg-background px-3 sm:px-4 dark:bg-brand-deep/40">
      <Link
        href={localeHomePath(locale)}
        aria-label={tCommon('homeLink')}
        className="rounded-lg px-1 py-1 transition-opacity hover:opacity-85"
      >
        <TekoWordmark logoClassName="size-6" />
      </Link>
      <nav aria-label={t('mainNav')} className="ml-3 hidden md:block">
        <ul className="flex items-center gap-0.5 rounded-xl bg-muted/70 p-1">
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
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 font-medium text-muted-foreground text-sm transition-[color,background-color,box-shadow] duration-150 hover:text-foreground [&_svg]:size-4',
                    current && 'bg-popover text-foreground shadow-soft [&_svg]:text-primary',
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
        <LanguageMenu />
        <ThemeSelector />
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <UserMenu />
      </div>
      <div aria-hidden="true" className="timeline-rule absolute inset-x-0 bottom-0 h-px" />
    </header>
  )
}
