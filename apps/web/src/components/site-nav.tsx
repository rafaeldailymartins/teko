'use client'

import { ArrowRightIcon, MenuIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { GitHubIcon } from '@/components/brand/github-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { localePagePath } from '@/lib/navigation'
import { REPOSITORY_URL } from '@/lib/site'
import { cn } from '@/lib/utils'

/** Páginas da navegação do site público, na ordem do cabeçalho. */
const SITE_NAV_PAGES = ['coverage', 'about'] as const

/** Páginas a mais no menu do celular (no desktop elas ficam no rodapé). */
const MOBILE_EXTRA_PAGES = ['privacy', 'terms'] as const

/** Garante a barra final, para comparar com os caminhos de `trailingSlash: true`. */
function withTrailingSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

/**
 * Navegação do cabeçalho público a partir de 768 px: links de texto com a página atual marcada
 * (`aria-current`) por um sublinhado verde-folha, o motivo da linha do tempo da logo.
 */
export function SiteNav() {
  const locale = useLocale()
  const pathname = withTrailingSlash(usePathname())
  const t = useTranslations('common')
  const tPages = useTranslations('pages')

  return (
    <nav aria-label={t('siteNav')} className="hidden md:block">
      <ul className="flex items-center gap-1">
        {SITE_NAV_PAGES.map((page) => {
          const href = localePagePath(locale, page)
          const current = pathname === href
          return (
            <li key={page}>
              <a
                href={href}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-9 items-center rounded-lg px-3 font-medium text-muted-foreground text-sm transition-colors duration-150 hover:bg-muted hover:text-foreground',
                  'after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-leaf after:opacity-0 after:transition-opacity',
                  current && 'text-foreground after:opacity-100',
                )}
              >
                {tPages(`${page}.title`)}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * Menu do celular (abaixo de 768 px): um Sheet com as páginas, o código-fonte e a chamada para o
 * app. Idioma e tema continuam no cabeçalho.
 */
export function SiteMobileMenu() {
  const locale = useLocale()
  const pathname = withTrailingSlash(usePathname())
  const t = useTranslations('common')
  const tPages = useTranslations('pages')
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={t('menu.open')} className="md:hidden" />
        }
      >
        <MenuIcon aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" closeLabel={t('close')} className="gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>{t('menu.title')}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t('siteNav')} className="flex flex-1 flex-col gap-6 p-4">
          <ul className="flex flex-col gap-1">
            {[...SITE_NAV_PAGES, ...MOBILE_EXTRA_PAGES].map((page) => {
              const href = localePagePath(locale, page)
              const current = pathname === href
              return (
                <li key={page}>
                  <a
                    href={href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center rounded-lg px-3 font-medium text-base transition-colors hover:bg-muted',
                      current && 'bg-muted text-foreground',
                    )}
                  >
                    {tPages(`${page}.title`)}
                  </a>
                </li>
              )
            })}
            <li>
              <a
                href={REPOSITORY_URL}
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 font-medium text-base transition-colors hover:bg-muted"
              >
                <GitHubIcon className="size-4" />
                {t('sourceCode')}
              </a>
            </li>
          </ul>
          <a
            href={localePagePath(locale, 'chat')}
            className={buttonVariants({ variant: 'brand', size: 'lg', className: 'mt-auto' })}
          >
            {t('openApp')}
            <ArrowRightIcon aria-hidden="true" />
          </a>
        </nav>
      </SheetContent>
    </Sheet>
  )
}
