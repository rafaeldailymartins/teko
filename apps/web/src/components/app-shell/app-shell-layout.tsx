import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import { routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { AppHeader } from './app-header.tsx'

interface AppShellLayoutProps {
  readonly children: ReactNode
  readonly params: Promise<{ locale: string }>
}

/**
 * Layout das páginas do app (grupo de rotas `(app)`): cabeçalho com paleta, conteúdo principal com
 * rolagem própria e o aviso fixo de que o Tekó não constitui parecer, sempre visível no rodapé.
 * Fica montado entre as páginas do grupo, então a navegação entre elas não recarrega o shell.
 */
export async function AppShellLayout({ children, params }: AppShellLayoutProps) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'common' })

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        {children}
      </main>
      <footer className="shrink-0 border-t bg-surface px-4 py-1.5">
        <p className="text-center text-muted-foreground text-xs">{t('disclaimer')}</p>
      </footer>
    </div>
  )
}
