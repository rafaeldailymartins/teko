import type { MeResponse } from '@teko/shared/contracts'
import { ErrorCode } from '@teko/shared/errors'

/**
 * Estado da sessão visto pela UI, a partir do `GET /v1/me`. A guarda é só de experiência: quem
 * decide é a API (401 sem sessão, 403 `onboarding_required` sem o onboarding).
 */
export const SessionStatus = {
  /** A primeira leitura de `/me` ainda não voltou. */
  Loading: 'loading',
  /** Sem sessão (401 `unauthenticated`). */
  Anonymous: 'anonymous',
  /** Com sessão, mas falta o onboarding ou o aceite de uma versão nova dos Termos. */
  Onboarding: 'onboarding',
  /** Com sessão e onboarding concluído: pode perguntar. */
  Ready: 'ready',
  /** `/me` falhou por outro motivo (rede, 5xx): não dá para afirmar nada. */
  Unavailable: 'unavailable',
} as const

export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus]

interface MeResult {
  readonly data: Pick<MeResponse, 'onboarding'> | undefined
  readonly error: { readonly code: ErrorCode } | null
}

export function sessionStatus({ data, error }: MeResult): SessionStatus {
  if (data !== undefined) {
    return data.onboarding.required ? SessionStatus.Onboarding : SessionStatus.Ready
  }
  if (error === null) {
    return SessionStatus.Loading
  }
  return error.code === ErrorCode.Unauthenticated
    ? SessionStatus.Anonymous
    : SessionStatus.Unavailable
}

/** O composer só fica liberado com sessão e onboarding concluído. */
export function isComposerBlocked(status: SessionStatus): boolean {
  return status !== SessionStatus.Ready
}

/** Variante do onboarding: o primeiro uso ou o novo aceite depois que `TERMS_VERSION` mudou. */
export const OnboardingKind = {
  First: 'first',
  TermsUpdate: 'termsUpdate',
} as const

export type OnboardingKind = (typeof OnboardingKind)[keyof typeof OnboardingKind]

export function onboardingKind({ onboarding }: Pick<MeResponse, 'onboarding'>): OnboardingKind {
  const accepted = onboarding.acceptedTermsVersion
  return accepted !== null && accepted !== onboarding.currentTermsVersion
    ? OnboardingKind.TermsUpdate
    : OnboardingKind.First
}

/** Iniciais do nome para o avatar (a foto do provedor fica de fora: a CSP só aceita imagens da origem). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const picked = words.length > 1 ? [...words.slice(0, 1), ...words.slice(-1)] : words
  return (
    picked
      .map((word) => word.charAt(0))
      .join('')
      .toLocaleUpperCase() || '?'
  )
}
