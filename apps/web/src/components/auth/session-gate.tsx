'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ErrorCode } from '@teko/shared/errors'
import { RotateCwIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useEffect } from 'react'
import { BrandScreen } from '@/components/brand/brand-screen'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api/errors'
import { meQuery } from '@/lib/api/queries'
import { currentReturnPath, regionRestrictedPath, signInPath } from '@/lib/auth/return-path'
import { SessionStatus } from '@/lib/auth/session'
import { OnboardingDialog } from './onboarding-dialog.tsx'
import { useSession, useSignOutAction } from './use-session.ts'

/** Nas configurações o onboarding não bloqueia: exportar e excluir a conta não podem depender dele. */
function isSettingsPath(pathname: string): boolean {
  return /^\/[^/]+\/settings\/?$/.test(pathname)
}

function isRegionRestricted(error: unknown): boolean {
  return error instanceof ApiError && error.code === ErrorCode.RegionRestricted
}

interface SessionGateProps {
  /** O app (cabeçalho, conteúdo e rodapé do shell): só aparece com a sessão pronta. */
  readonly children: ReactNode
}

/**
 * Guarda de experiência das páginas do app (grupo `(app)`), em volta do shell. Não protege nada (a
 * API recusa sem sessão), mas o app só aparece depois de saber a sessão, sem pintar a tela e pular
 * para a entrada:
 *
 * - enquanto o `GET /me` carrega (inclusive no HTML estático, antes da hidratação), a tela da marca;
 * - sem sessão, a mesma tela enquanto vai direto para a entrada (`router.replace`, com o retorno à
 *   página e à query atuais);
 * - `/me` indisponível (rede, 5xx), a tela da marca com "Tentar de novo";
 * - com sessão, o app; com o onboarding pendente, também o diálogo bloqueante.
 *
 * Qualquer consulta ou mutação recusada com `region_restricted` leva à página de aviso.
 */
export function SessionGate({ children }: SessionGateProps) {
  const session = useSession()
  const { signOut } = useSignOutAction()
  const router = useRouter()
  const locale = useLocale()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const t = useTranslations('shell.gate')

  useEffect(() => {
    if (session.status === SessionStatus.Anonymous) {
      router.replace(signInPath(locale, currentReturnPath(window.location)))
    }
  }, [session.status, router, locale])

  useEffect(() => {
    const toNotice = () => router.push(regionRestrictedPath(locale))
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && isRegionRestricted(event.query.state.error)) toNotice()
    })
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && isRegionRestricted(event.mutation.state.error)) toNotice()
    })
    return () => {
      unsubscribeQueries()
      unsubscribeMutations()
    }
  }, [queryClient, router, locale])

  switch (session.status) {
    case SessionStatus.Loading:
      return <BrandScreen busy label={t('loading')} />
    case SessionStatus.Anonymous:
      return <BrandScreen busy label={t('redirecting')} />
    case SessionStatus.Unavailable:
      return (
        <BrandScreen label={t('unavailableBody')}>
          <h1 className="order-first font-semibold font-serif text-2xl tracking-tight">
            {t('unavailableTitle')}
          </h1>
          <Button
            variant="outline"
            onClick={() => queryClient.refetchQueries({ queryKey: meQuery().queryKey })}
          >
            <RotateCwIcon aria-hidden="true" />
            {t('retry')}
          </Button>
        </BrandScreen>
      )
    default:
      return (
        <>
          {children}
          {session.status === SessionStatus.Onboarding &&
            session.me !== null &&
            !isSettingsPath(pathname) && (
              <OnboardingDialog me={session.me} open onSignOut={signOut} />
            )}
        </>
      )
  }
}
