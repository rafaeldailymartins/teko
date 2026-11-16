'use client'

import {
  CircleUserRoundIcon,
  DatabaseIcon,
  GaugeIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { OnboardingDialog } from '@/components/auth/onboarding-dialog'
import { useSession, useSignOutAction } from '@/components/auth/use-session'
import { GitHubIcon } from '@/components/brand/github-icon'
import { GoogleIcon } from '@/components/brand/google-icon'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { GetMeResponse } from '@/lib/api/__generated__/types.gen'
import { SignInMethod } from '@/lib/api/auth'
import { useQuota, useSignInMethods } from '@/lib/api/hooks'
import { initialsOf, SessionStatus } from '@/lib/auth/session'
import { cn } from '@/lib/utils'
import { DangerSection, DataSection } from './data-section.tsx'
import { PasskeysSection } from './passkeys-section.tsx'
import { PreferencesSection } from './preferences-section.tsx'
import { SettingsNav, type SettingsNavItem } from './settings-nav.tsx'
import { SettingsSection } from './settings-section.tsx'

function countryName(code: string | null, locale: string): string | null {
  if (code === null) {
    return null
  }
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code
}

const METHOD_ICONS = {
  [SignInMethod.GitHub]: GitHubIcon,
  [SignInMethod.Google]: GoogleIcon,
  [SignInMethod.Email]: MailIcon,
} as const

/** Como a conta entra: um selo por método ligado (GitHub, Google ou e-mail e senha). */
function SignInMethods() {
  const t = useTranslations('settings.account')
  const methods = useSignInMethods()
  if (methods.isPending) {
    return <Skeleton className="h-7 w-36 rounded-full" />
  }
  if (methods.data === undefined || methods.data.length === 0) {
    return <span className="text-muted-foreground">{t('methodUnknown')}</span>
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {methods.data.map((method) => {
        const Icon = METHOD_ICONS[method]
        return (
          <li
            key={method}
            className="inline-flex items-center gap-1.5 rounded-full border bg-surface px-2.5 py-1 font-medium text-xs"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {t(`methods.${method}`)}
          </li>
        )
      })}
    </ul>
  )
}

function AccountSection({ me }: { readonly me: GetMeResponse }) {
  const t = useTranslations('settings.account')
  const locale = useLocale()
  const { signOut, pending } = useSignOutAction()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const country = countryName(me.onboarding.countryOfResidence, locale)

  return (
    <SettingsSection id="account" title={t('title')} icon={CircleUserRoundIcon}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span
          aria-hidden="true"
          className="flex size-12 shrink-0 sm:size-14 items-center justify-center rounded-full bg-brand-gradient font-semibold text-brand-foreground text-lg shadow-raised ring-4 ring-leaf-soft"
        >
          {initialsOf(me.name)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate font-semibold font-serif text-lg leading-tight">{me.name}</p>
          <p className="truncate text-muted-foreground">{me.email}</p>
        </div>
        <Button variant="outline" className="max-sm:ml-16" disabled={pending} onClick={signOut}>
          <LogOutIcon aria-hidden="true" />
          {t('signOut')}
        </Button>
      </div>
      <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-6 gap-y-3 rounded-xl border bg-surface/60 p-4">
        <dt className="text-muted-foreground text-sm">{t('method')}</dt>
        <dd>
          <SignInMethods />
        </dd>
        {country !== null && (
          <>
            <dt className="text-muted-foreground text-sm">{t('country')}</dt>
            <dd>{country}</dd>
          </>
        )}
      </dl>
      {me.onboarding.required && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent-border/40 bg-accent/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-pretty">{t('onboardingPending')}</p>
          <Button size="sm" className="shrink-0" onClick={() => setOnboardingOpen(true)}>
            {t('completeOnboarding')}
          </Button>
          <OnboardingDialog me={me} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
        </div>
      )}
    </SettingsSection>
  )
}

/** Barra de uso da cota (`<meter>` nativo não tem estilo estável entre navegadores). */
function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      className="relative h-2.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300 ease-out-soft',
          ratio >= 0.8 ? 'bg-date-mark' : 'bg-leaf-gradient',
        )}
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  )
}

function QuotaSection() {
  const t = useTranslations('settings.quota')
  const tErrors = useTranslations('errors')
  const format = useFormatter()
  const quota = useQuota()

  return (
    <SettingsSection id="quota" title={t('title')} description={t('lead')} icon={GaugeIcon}>
      {quota.data === undefined ? (
        quota.error === null ? (
          <div className="flex flex-col gap-3" role="status" aria-label={t('loading')}>
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-6 w-32 rounded-full" />
            </div>
            <Skeleton className="h-2.5 rounded-full" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{tErrors(quota.error.code)}</p>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="font-medium text-lg tabular-nums">
              {t('user', { used: quota.data.user.used, limit: quota.data.user.limit })}
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-leaf/40 bg-leaf-soft px-2.5 py-1 font-medium text-validity-current text-xs tabular-nums">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-leaf" />
              {t('remaining', {
                count: Math.max(0, quota.data.user.limit - quota.data.user.used),
              })}
            </span>
          </div>
          <UsageBar used={quota.data.user.used} limit={quota.data.user.limit} label={t('title')} />
          <div className="flex flex-col gap-1 text-muted-foreground text-sm sm:flex-row sm:justify-between">
            <p className="tabular-nums">
              {t('global', { used: quota.data.global.used, limit: quota.data.global.limit })}
            </p>
            <p className="font-mono text-xs tabular-nums sm:text-[0.8125rem]">
              {t('resets', {
                time: format.dateTime(new Date(quota.data.resetAt), {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }),
              })}
            </p>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}

/** Esqueleto das seções da conta, com a forma dos cartões, enquanto o `/me` carrega. */
function SettingsSkeleton({ label }: { readonly label: string }) {
  return (
    <div className="flex flex-col gap-5" role="status" aria-label={label}>
      {[0, 1, 2].map((card) => (
        <div
          key={card}
          className="flex flex-col gap-4 rounded-xl border bg-popover p-5 shadow-soft"
        >
          <div className="flex items-center gap-3.5">
            <Skeleton className="size-9 rounded-lg" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          </div>
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

/**
 * Configurações: conta (com o método de entrada), cota do dia, passkeys, preferências, dados e a
 * zona de perigo, com a navegação lateral no desktop. Sem sessão, a `SessionGate` do shell já está
 * levando para a entrada; aqui só as preferências aparecem.
 */
export function SettingsView() {
  const t = useTranslations('settings')
  const { status, me } = useSession()
  const signedIn =
    me !== null && (status === SessionStatus.Ready || status === SessionStatus.Onboarding)

  const items: SettingsNavItem[] = [
    ...(signedIn
      ? [
          { id: 'account', label: t('account.title'), icon: CircleUserRoundIcon },
          { id: 'quota', label: t('quota.title'), icon: GaugeIcon },
          { id: 'passkeys', label: t('passkeys.title'), icon: KeyRoundIcon },
        ]
      : []),
    { id: 'preferences', label: t('preferences.title'), icon: SlidersHorizontalIcon },
    ...(signedIn
      ? [
          { id: 'data', label: t('data.title'), icon: DatabaseIcon },
          { id: 'danger', label: t('danger.title'), icon: TriangleAlertIcon },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[12.5rem_minmax(0,1fr)] lg:items-start lg:gap-10">
      <SettingsNav items={items} />
      <div className="flex min-w-0 flex-col gap-5">
        {signedIn ? (
          <>
            <AccountSection me={me} />
            <QuotaSection />
            <PasskeysSection />
          </>
        ) : status === SessionStatus.Unavailable ? (
          <p className="text-muted-foreground" aria-live="polite">
            {t('unavailable')}
          </p>
        ) : (
          <SettingsSkeleton label={t('loading')} />
        )}
        <PreferencesSection />
        {signedIn && (
          <>
            <DataSection />
            <DangerSection />
          </>
        )}
      </div>
    </div>
  )
}
