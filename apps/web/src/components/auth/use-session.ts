'use client'

import { useLocale } from 'next-intl'
import type { GetMeResponse } from '@/lib/api/__generated__/types.gen'
import { useMe, useSignOut } from '@/lib/api/hooks'
import { isComposerBlocked, type SessionStatus, sessionStatus } from '@/lib/auth/session'
import { navigateTo } from '@/lib/browser'
import { localeHomePath } from '@/lib/i18n/routing'

interface Session {
  readonly status: SessionStatus
  /** Usuário da sessão (`null` sem sessão ou enquanto carrega). */
  readonly me: GetMeResponse | null
  /**
   * O composer do chat deve ficar desabilitado: sem sessão, carregando ou com o onboarding
   * pendente. É o ponto de encaixe da conversa (`add-chat-experience`).
   */
  readonly composerBlocked: boolean
}

/** Sessão vista pela UI, a partir do `GET /v1/me` em cache (uma leitura para a página toda). */
export function useSession(): Session {
  const { data, error } = useMe()
  const status = sessionStatus({ data, error })
  return { status, me: data ?? null, composerBlocked: isComposerBlocked(status) }
}

/**
 * Sai da conta e recarrega na página inicial: a navegação completa descarta o cache de consultas
 * e o estado da conversa da sessão que acabou.
 */
export function useSignOutAction(): { readonly signOut: () => void; readonly pending: boolean } {
  const locale = useLocale()
  const mutation = useSignOut()
  return {
    pending: mutation.isPending,
    signOut: () =>
      mutation.mutate(undefined, {
        onSuccess: () => navigateTo(localeHomePath(locale)),
      }),
  }
}
