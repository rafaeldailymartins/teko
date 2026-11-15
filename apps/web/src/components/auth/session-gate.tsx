'use client'

import { useQueryClient } from '@tanstack/react-query'
import { ErrorCode } from '@teko/shared/errors'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useEffect } from 'react'
import { ApiError } from '@/lib/api/errors'
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

/**
 * Guarda de experiência das páginas do app (grupo `(app)`), montada no layout do shell. Não protege
 * nada (a API recusa sem sessão): sem sessão, manda para a entrada com o retorno à página atual; com
 * o onboarding pendente, abre o diálogo bloqueante; e qualquer consulta ou mutação recusada com
 * `region_restricted` leva à página de aviso.
 */
export function SessionGate() {
  const session = useSession()
  const { signOut } = useSignOutAction()
  const router = useRouter()
  const locale = useLocale()
  const pathname = usePathname()
  const queryClient = useQueryClient()

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

  if (session.status !== SessionStatus.Onboarding || session.me === null) {
    return null
  }
  if (isSettingsPath(pathname)) {
    return null
  }
  return <OnboardingDialog me={session.me} open onSignOut={signOut} />
}
