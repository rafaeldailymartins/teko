import { notFound } from 'next/navigation'
import { hasLocale } from 'next-intl'
import { setRequestLocale } from 'next-intl/server'
import type { ReactNode } from 'react'
import { SessionGate } from '@/components/auth/session-gate'
import { routing } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID } from '@/lib/site'
import { AppDisclaimer } from './app-disclaimer.tsx'
import { AppHeader } from './app-header.tsx'

interface AppShellLayoutProps {
  readonly children: ReactNode
  readonly params: Promise<{ locale: string }>
}

/**
 * Layout das páginas do app (grupo de rotas `(app)`): cabeçalho com paleta e conteúdo principal com
 * rolagem própria, que termina no aviso discreto de que o Tekó não constitui parecer (no chat, o
 * aviso fica abaixo do composer). As preferências de cookies ficam no menu da conta.
 * Fica montado entre as páginas do grupo, então a navegação entre elas não recarrega o shell. A
 * `SessionGate` envolve o shell: até saber a sessão (e no HTML estático) mostra a tela da marca, sem
 * sessão vai direto para a entrada, e com o onboarding pendente abre o diálogo.
 */
export async function AppShellLayout({ children, params }: AppShellLayoutProps) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)

  return (
    <SessionGate>
      <div className="flex h-dvh flex-col bg-background">
        <AppHeader />
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto focus:outline-none"
        >
          {children}
          <AppDisclaimer />
        </main>
      </div>
    </SessionGate>
  )
}
