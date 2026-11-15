'use client'

import { useQueryClient } from '@tanstack/react-query'
import { CircleAlertIcon, FingerprintIcon, LoaderCircleIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  OAuthProvider,
  PasskeyError,
  signInWithPasskey,
  startSocialSignIn,
  supportsPasskeys,
} from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { meQuery } from '@/lib/api/queries'
import {
  ERROR_PARAM,
  RETURN_PARAM,
  SignInError,
  safeReturnPath,
  signInErrorOf,
  signInPath,
} from '@/lib/auth/return-path'
import { SessionStatus } from '@/lib/auth/session'
import { navigateTo } from '@/lib/browser'
import { localePagePath } from '@/lib/navigation'
import { RegionNotice } from './region-notice.tsx'
import { useSession } from './use-session.ts'

const noSubscription = () => () => {}

/** WebAuthn no navegador; no HTML estático o botão sai habilitado e some depois se faltar suporte. */
function usePasskeySupport(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => supportsPasskeys(),
    () => true,
  )
}

/** Chave do rótulo de cada provedor em `auth.signIn`. */
const PROVIDER_LABEL_KEYS = {
  [OAuthProvider.GitHub]: 'github',
  [OAuthProvider.Google]: 'google',
} as const

type Pending = OAuthProvider | 'passkey' | null

interface SignInPanelProps {
  /** Título da página (o mesmo do HTML estático, que vem do servidor). */
  readonly title: string
}

function Alert({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div>{children}</div>
    </div>
  )
}

/**
 * Entrada: GitHub, Google e passkey. O retorno (`?callbackURL=`) é saneado antes de ir para o Better
 * Auth, e um `?error=` do callback vira mensagem; `region_restricted` vira a página de aviso.
 */
export function SignInPanel({ title }: SignInPanelProps) {
  const t = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const session = useSession()
  const passkeySupported = usePasskeySupport()
  const [pending, setPending] = useState<Pending>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const returnTo = safeReturnPath(params.get(RETURN_PARAM), locale)
  const callbackError = signInErrorOf(params.get(ERROR_PARAM))

  if (callbackError === SignInError.RegionRestricted) {
    return <RegionNotice />
  }

  const describe = (error: unknown): string => {
    if (error instanceof PasskeyError) {
      return t(`passkey.${error.failure}`)
    }
    return error instanceof ApiError ? tErrors(error.code) : t('errors.generic')
  }

  const signInWith = async (provider: OAuthProvider) => {
    setPending(provider)
    setFailure(null)
    try {
      const url = await startSocialSignIn(provider, {
        callbackURL: returnTo,
        errorCallbackURL: signInPath(locale, returnTo),
      })
      navigateTo(url)
    } catch (error) {
      setFailure(describe(error))
      setPending(null)
    }
  }

  const signInWithKey = async () => {
    setPending('passkey')
    setFailure(null)
    try {
      await signInWithPasskey()
      await queryClient.invalidateQueries({ queryKey: meQuery().queryKey })
      router.replace(returnTo)
    } catch (error) {
      setFailure(describe(error))
      setPending(null)
    }
  }

  const signedIn =
    session.me !== null &&
    (session.status === SessionStatus.Ready || session.status === SessionStatus.Onboarding)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold font-serif text-3xl tracking-tight">{title}</h1>
        <p className="text-pretty text-muted-foreground leading-relaxed">{t('signIn.lead')}</p>
      </div>

      {callbackError !== null && (
        <Alert>
          <p className="font-medium">{t('errors.title')}</p>
          <p className="text-muted-foreground">{t(`errors.${callbackError}`)}</p>
        </Alert>
      )}
      {failure !== null && <Alert>{failure}</Alert>}

      {signedIn && session.me !== null ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-surface p-4">
          <p>{t('signIn.alreadySignedIn', { name: session.me.name })}</p>
          <Link href={returnTo} className={buttonVariants({ className: 'self-start' })}>
            {t('signIn.continue')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2" aria-busy={pending !== null}>
          {[OAuthProvider.GitHub, OAuthProvider.Google].map((provider) => (
            <Button
              key={provider}
              size="lg"
              variant="outline"
              disabled={pending !== null}
              onClick={() => signInWith(provider)}
            >
              {pending === provider && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              {t(`signIn.${PROVIDER_LABEL_KEYS[provider]}`)}
            </Button>
          ))}
          {passkeySupported && (
            <Button size="lg" disabled={pending !== null} onClick={signInWithKey}>
              {pending === 'passkey' ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <FingerprintIcon aria-hidden="true" />
              )}
              {t('signIn.passkey')}
            </Button>
          )}
          <p className="text-muted-foreground text-xs">{t('signIn.noPassword')}</p>
        </div>
      )}

      <p className="text-muted-foreground text-sm">
        {t.rich('signIn.legal', {
          terms: (chunks) => (
            <Link href={localePagePath(locale, 'terms')} className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href={localePagePath(locale, 'privacy')} className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </div>
  )
}
