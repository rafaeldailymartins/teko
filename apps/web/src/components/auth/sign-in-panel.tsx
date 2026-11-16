'use client'

import { useQueryClient } from '@tanstack/react-query'
import { AuthMethod } from '@teko/shared/contracts'
import { ArrowRightIcon, CircleAlertIcon, FingerprintIcon, LoaderCircleIcon } from 'lucide-react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useState, useSyncExternalStore } from 'react'
import { GitHubIcon } from '@/components/brand/github-icon'
import { GoogleIcon } from '@/components/brand/google-icon'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  OAuthProvider,
  PasskeyError,
  signInWithPasskey,
  startSocialSignIn,
  supportsPasskeys,
} from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { useAuthProviders } from '@/lib/api/hooks'
import { meQuery } from '@/lib/api/queries'
import {
  ERROR_PARAM,
  RETURN_PARAM,
  SignInError,
  safeReturnPath,
  signInErrorOf,
  signInPath,
} from '@/lib/auth/return-path'
import { initialsOf, SessionStatus } from '@/lib/auth/session'
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

/**
 * Métodos sempre ligados (`authMethodsOf` da API): se o `GET /auth/providers` falhar, a tela ainda
 * oferece a passkey e o e-mail, que dão o próprio erro se a API estiver fora.
 */
const FALLBACK_METHODS: readonly AuthMethod[] = [AuthMethod.Passkey, AuthMethod.Email]

const PROVIDERS = [
  { provider: OAuthProvider.GitHub, label: 'github', Icon: GitHubIcon },
  { provider: OAuthProvider.Google, label: 'google', Icon: GoogleIcon },
] as const

type Pending = OAuthProvider | 'passkey' | null

interface SignInPanelProps {
  /** Título da página (o mesmo do HTML estático, que vem do servidor). */
  readonly title: string
}

function Alert({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 text-sm"
    >
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

/** Título e introdução da entrada (também no HTML estático, como fallback do `<Suspense>`). */
export function SignInHeading({ title, lead }: { readonly title: string; readonly lead: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h1 className="text-balance font-semibold font-serif text-[2rem] leading-tight tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="text-pretty text-muted-foreground leading-relaxed">{lead}</p>
    </div>
  )
}

/**
 * Esqueleto com a forma da entrada (botões, divisória, abas, dois campos e o envio), enquanto os
 * métodos carregam e no HTML estático: a página não pula quando eles chegam.
 */
export function SignInSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label={label}>
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-11 rounded-lg" />
        <Skeleton className="h-11 rounded-lg" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-px flex-1" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-px flex-1" />
      </div>
      <EmailFormSkeleton />
    </div>
  )
}

/** Esqueleto do formulário de e-mail: as abas, os dois campos e o envio. */
function EmailFormSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-11 rounded-xl" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-11 rounded-lg" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-11 rounded-lg" />
      </div>
      <Skeleton className="h-11 rounded-lg" />
    </div>
  )
}

/**
 * O formulário de e-mail e senha (abas, validação pelos schemas da API) num chunk próprio, buscado
 * junto com os métodos de entrada: fica fora do JS de primeiro acesso, e o esqueleto ocupa o lugar.
 */
const EmailAuthForm = dynamic(
  () => import('./email-auth-form.tsx').then((module) => module.EmailAuthForm),
  { ssr: false, loading: EmailFormSkeleton },
)

/** Divisória "ou com e-mail" entre os provedores e o formulário. */
function Divider({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-muted-foreground text-xs">
      <span aria-hidden="true" className="timeline-rule h-px flex-1" />
      <span>{children}</span>
      <span aria-hidden="true" className="timeline-rule h-px flex-1" />
    </div>
  )
}

/**
 * Entrada: GitHub e Google (quando o ambiente tem os OAuth apps), passkey e e-mail e senha, só os
 * métodos que `GET /auth/providers` diz estarem ativos. O retorno (`?callbackURL=`) é saneado antes
 * de ir para o Better Auth, e um `?error=` do callback vira mensagem; `region_restricted` vira a
 * página de aviso.
 */
export function SignInPanel({ title }: SignInPanelProps) {
  const t = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const params = useSearchParams()
  const session = useSession()
  const providers = useAuthProviders()
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

  const methods: readonly AuthMethod[] = providers.isError
    ? FALLBACK_METHODS
    : (providers.data?.methods ?? [])
  const oauth = PROVIDERS.filter(({ provider }) => methods.includes(provider))
  const withPasskey = passkeySupported && methods.includes(AuthMethod.Passkey)
  const withEmail = methods.includes(AuthMethod.Email)

  const legalLink = (page: 'terms' | 'privacy') => (chunks: ReactNode) => (
    <Link
      href={localePagePath(locale, page)}
      className="text-foreground underline decoration-border-strong/60 underline-offset-4 transition-colors hover:decoration-foreground"
    >
      {chunks}
    </Link>
  )

  return (
    <div className="flex flex-col gap-7">
      <SignInHeading title={title} lead={t('signIn.lead')} />

      {callbackError !== null && (
        <Alert>
          <p className="font-medium">{t('errors.title')}</p>
          <p className="text-muted-foreground">{t(`errors.${callbackError}`)}</p>
        </Alert>
      )}
      {failure !== null && <Alert>{failure}</Alert>}

      {signedIn && session.me !== null ? (
        <Card tone="raised" className="flex items-center gap-4 p-4">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-gradient font-semibold text-brand-foreground text-sm"
          >
            {initialsOf(session.me.name)}
          </span>
          <p className="min-w-0 flex-1 text-pretty">
            {t('signIn.alreadySignedIn', { name: session.me.name })}
          </p>
          <Link href={returnTo} className={buttonVariants({ variant: 'brand' })}>
            {t('signIn.continue')}
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Card>
      ) : providers.isPending ? (
        <SignInSkeleton label={t('signIn.loading')} />
      ) : (
        <div className="flex flex-col gap-5" aria-busy={pending !== null}>
          {(oauth.length > 0 || withPasskey) && (
            <div className="flex flex-col gap-2.5">
              {oauth.map(({ provider, label, Icon }) => (
                <Button
                  key={provider}
                  size="lg"
                  variant="outline"
                  className="h-11 justify-center"
                  disabled={pending !== null}
                  onClick={() => signInWith(provider)}
                >
                  {pending === provider ? (
                    <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                  ) : (
                    <Icon className="size-[1.125rem]" />
                  )}
                  {t(`signIn.${label}`)}
                </Button>
              ))}
              {withPasskey && (
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11"
                  disabled={pending !== null}
                  onClick={signInWithKey}
                >
                  {pending === 'passkey' ? (
                    <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
                  ) : (
                    <FingerprintIcon aria-hidden="true" className="size-[1.125rem] text-primary" />
                  )}
                  {t('signIn.passkey')}
                </Button>
              )}
            </div>
          )}
          {withEmail && (
            <>
              {(oauth.length > 0 || withPasskey) && <Divider>{t('signIn.divider')}</Divider>}
              <EmailAuthForm returnTo={returnTo} disabled={pending !== null} />
            </>
          )}
        </div>
      )}

      <p className="text-pretty text-muted-foreground text-xs leading-relaxed">
        {t.rich('signIn.legal', { terms: legalLink('terms'), privacy: legalLink('privacy') })}
      </p>
    </div>
  )
}
