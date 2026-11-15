'use client'

import { CircleAlertIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { GetMeResponse } from '@/lib/api/__generated__/types.gen'
import { ApiError } from '@/lib/api/errors'
import { useCompleteOnboarding } from '@/lib/api/hooks'
import { OnboardingKind, onboardingKind } from '@/lib/auth/session'
import { countryOptions, DEFAULT_COUNTRY, isCountryCode } from '@/lib/countries'
import { localePagePath } from '@/lib/navigation'

interface OnboardingDialogProps {
  readonly me: GetMeResponse
  readonly open: boolean
  /**
   * Sem `onOpenChange`, o diálogo não fecha (`Esc` e clique fora não fazem nada): é o bloqueio do
   * primeiro uso. Nas configurações ele é opcional e fecha normalmente.
   */
  readonly onOpenChange?: (open: boolean) => void
  /** Ação secundária do diálogo bloqueante (sair da conta). */
  readonly onSignOut?: () => void
}

const linkClass = 'font-medium text-primary underline underline-offset-4'

/**
 * Onboarding do primeiro uso (e de cada versão nova dos Termos): aviso de que o provedor de IA
 * gratuito pode treinar com as perguntas, 18+, aceite da versão vigente e país de residência. O
 * `POST /me/onboarding` devolve o `/me` atualizado, e a guarda libera o app sem nova leitura.
 */
export function OnboardingDialog({ me, open, onOpenChange, onSignOut }: OnboardingDialogProps) {
  const t = useTranslations('onboarding')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const id = useId()
  const countries = useMemo(() => countryOptions(locale), [locale])
  const saved = me.onboarding.countryOfResidence
  const [adult, setAdult] = useState(false)
  const [terms, setTerms] = useState(false)
  const [country, setCountry] = useState(isCountryCode(saved) ? saved : DEFAULT_COUNTRY)
  const onboarding = useCompleteOnboarding()
  const kind = onboardingKind(me)
  const version = me.onboarding.currentTermsVersion
  const dismissible = onOpenChange !== undefined

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!(adult && terms)) {
      return
    }
    onboarding.mutate(
      { isAdult: true, termsVersion: version, countryOfResidence: country },
      { onSuccess: () => onOpenChange?.(false) },
    )
  }

  const error = onboarding.error
  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal={!dismissible}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-semibold font-serif text-xl">
            {kind === OnboardingKind.TermsUpdate ? t('titleTermsUpdate') : t('title')}
          </DialogTitle>
          <DialogDescription>
            {kind === OnboardingKind.TermsUpdate ? t('leadTermsUpdate') : t('lead')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" aria-busy={onboarding.isPending}>
          <div className="flex gap-3 rounded-lg border border-degraded/40 bg-muted p-3">
            <SparklesIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t('training.title')}</p>
              <p className="text-muted-foreground">{t('training.body')}</p>
            </div>
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              required
              checked={adult}
              onChange={(event) => setAdult(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>{t('adult')}</span>
          </label>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              required
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              {t.rich('terms', {
                version,
                terms: (chunks) => (
                  <Link href={localePagePath(locale, 'terms')} className={linkClass}>
                    {chunks}
                  </Link>
                ),
                privacy: (chunks) => (
                  <Link href={localePagePath(locale, 'privacy')} className={linkClass}>
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-country`} className="font-medium">
              {t('country')}
            </label>
            <select
              id={`${id}-country`}
              aria-describedby={`${id}-country-hint`}
              value={country}
              onChange={(event) => setCountry(event.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {countries.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
            <p id={`${id}-country-hint`} className="text-muted-foreground text-xs">
              {t('countryHint')}
            </p>
          </div>

          {error !== null && (
            <p role="alert" className="flex gap-2 text-destructive">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {error instanceof ApiError ? tErrors(error.code) : tErrors('internal')}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {onSignOut !== undefined && (
              <Button type="button" variant="ghost" onClick={onSignOut}>
                {t('signOut')}
              </Button>
            )}
            <Button type="submit" disabled={!(adult && terms) || onboarding.isPending}>
              {onboarding.isPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              {onboarding.isPending ? t('submitting') : t('submit')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
