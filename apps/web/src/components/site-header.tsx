import type { Locale } from '@teko/shared/i18n'
import { ArrowRightIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'
import { GitHubIcon } from '@/components/brand/github-icon'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { LanguageMenu } from '@/components/language-menu'
import { SiteMobileMenu, SiteNav } from '@/components/site-nav'
import { ThemeSelector } from '@/components/theme-selector'
import { buttonVariants } from '@/components/ui/button'
import { localeHomePath } from '@/lib/i18n/routing'
import { localePagePath } from '@/lib/navigation'
import { REPOSITORY_URL } from '@/lib/site'

interface SiteHeaderProps {
  readonly locale: Locale
}

/**
 * Cabeçalho público, fixo no topo com fundo translúcido: a marca (link para a inicial do locale), a
 * navegação, o código-fonte, idioma, tema e a chamada "Abrir o Tekó" no gradiente da logo. No
 * celular, a navegação e a chamada vão para o menu. O fio de baixo é a linha do tempo da logo.
 */
export async function SiteHeader({ locale }: SiteHeaderProps) {
  const t = await getTranslations({ locale, namespace: 'common' })

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-5">
        <a
          href={localeHomePath(locale)}
          aria-label={t('homeLink')}
          className="-ml-1 rounded-lg px-1 py-1 transition-opacity hover:opacity-85"
        >
          <TekoWordmark />
        </a>
        <div className="ml-4 hidden md:block">
          <SiteNav />
        </div>
        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <a
            href={REPOSITORY_URL}
            rel="noopener noreferrer"
            aria-label={t('sourceCode')}
            className={buttonVariants({
              variant: 'ghost',
              size: 'icon',
              className: 'max-md:hidden',
            })}
          >
            <GitHubIcon className="size-4" />
          </a>
          <LanguageMenu />
          <ThemeSelector />
          <a
            href={localePagePath(locale, 'chat')}
            className={buttonVariants({ variant: 'brand', className: 'ml-1.5 max-sm:hidden' })}
          >
            {t('openApp')}
            <ArrowRightIcon aria-hidden="true" />
          </a>
          <SiteMobileMenu />
        </div>
      </div>
      <div aria-hidden="true" className="timeline-rule h-px" />
    </header>
  )
}
