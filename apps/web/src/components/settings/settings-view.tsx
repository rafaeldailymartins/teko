'use client'

import { LogOutIcon } from 'lucide-react'
import { useFormatter, useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { OnboardingDialog } from '@/components/auth/onboarding-dialog'
import { useSession, useSignOutAction } from '@/components/auth/use-session'
import { Button } from '@/components/ui/button'
import type { GetMeResponse } from '@/lib/api/__generated__/types.gen'
import { useQuota } from '@/lib/api/hooks'
import { SessionStatus } from '@/lib/auth/session'
import { DataSection } from './data-section.tsx'
import { PasskeysSection } from './passkeys-section.tsx'
import { PreferencesSection } from './preferences-section.tsx'
import { SettingsSection } from './settings-section.tsx'

function countryName(code: string | null, locale: string): string | null {
  if (code === null) {
    return null
  }
  return new Intl.DisplayNames([locale], { type: 'region', fallback: 'code' }).of(code) ?? code
}

function AccountSection({ me }: { readonly me: GetMeResponse }) {
  const t = useTranslations('settings.account')
  const locale = useLocale()
  const { signOut, pending } = useSignOutAction()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const country = countryName(me.onboarding.countryOfResidence, locale)

  return (
    <SettingsSection id="account" title={t('title')}>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
        <dt className="text-muted-foreground">{t('name')}</dt>
        <dd className="min-w-0 truncate">{me.name}</dd>
        <dt className="text-muted-foreground">{t('email')}</dt>
        <dd className="min-w-0 truncate">{me.email}</dd>
        {country !== null && (
          <>
            <dt className="text-muted-foreground">{t('country')}</dt>
            <dd>{country}</dd>
          </>
        )}
      </dl>
      {me.onboarding.required && (
        <div className="flex flex-col gap-2 rounded-lg border border-degraded/40 bg-muted p-3 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('onboardingPending')}</p>
          <Button size="sm" onClick={() => setOnboardingOpen(true)}>
            {t('completeOnboarding')}
          </Button>
          <OnboardingDialog me={me} open={onboardingOpen} onOpenChange={setOnboardingOpen} />
        </div>
      )}
      <Button variant="outline" className="self-start" disabled={pending} onClick={signOut}>
        <LogOutIcon aria-hidden="true" />
        {t('signOut')}
      </Button>
    </SettingsSection>
  )
}

/** Barra de uso da cota (`<meter>` nativo não tem estilo estável entre navegadores). */
function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={Math.min(used, limit)}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  )
}

function QuotaSection() {
  const t = useTranslations('settings.quota')
  const tErrors = useTranslations('errors')
  const format = useFormatter()
  const quota = useQuota()

  return (
    <SettingsSection id="quota" title={t('title')} description={t('lead')}>
      {quota.data === undefined ? (
        <p className="text-muted-foreground text-sm">
          {quota.error === null ? t('loading') : tErrors(quota.error.code)}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <p className="font-medium tabular-nums">
              {t('user', { used: quota.data.user.used, limit: quota.data.user.limit })}
            </p>
            <UsageBar
              used={quota.data.user.used}
              limit={quota.data.user.limit}
              label={t('title')}
            />
          </div>
          <p className="text-muted-foreground text-sm tabular-nums">
            {t('global', { used: quota.data.global.used, limit: quota.data.global.limit })}
          </p>
          <p className="text-muted-foreground text-sm">
            {t('resets', {
              time: format.dateTime(new Date(quota.data.resetAt), {
                dateStyle: 'short',
                timeStyle: 'short',
              }),
            })}
          </p>
        </div>
      )}
    </SettingsSection>
  )
}

/**
 * Configurações: conta, cota do dia, passkeys, dados (exportar e excluir) e preferências. Sem
 * sessão, a `SessionGate` do shell já está levando para a entrada; aqui só as preferências aparecem.
 */
export function SettingsView() {
  const t = useTranslations('settings')
  const { status, me } = useSession()
  const signedIn =
    me !== null && (status === SessionStatus.Ready || status === SessionStatus.Onboarding)

  return (
    <div className="flex flex-col gap-4">
      {signedIn ? (
        <>
          <AccountSection me={me} />
          <QuotaSection />
          <PasskeysSection />
          <DataSection />
        </>
      ) : (
        <p className="text-muted-foreground" aria-live="polite">
          {status === SessionStatus.Unavailable ? t('unavailable') : t('loading')}
        </p>
      )}
      <PreferencesSection />
    </div>
  )
}
