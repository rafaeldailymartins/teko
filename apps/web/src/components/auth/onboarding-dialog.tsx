'use client'

import { CheckIcon, CircleAlertIcon, LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useMemo, useState } from 'react'
import { TekoLogo } from '@/components/brand/teko-logo'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { cn } from '@/lib/utils'
import { CountryPicker } from './country-picker.tsx'

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

interface StepProps {
  readonly index: number
  readonly title: string
  readonly done: boolean
  /** Último passo: sem o fio que liga ao próximo. */
  readonly last?: boolean
  /** `id` do título, para um campo do passo usar como rótulo. */
  readonly titleId?: string
  readonly children: ReactNode
}

/**
 * Um passo da linha do tempo do cadastro: o marcador (número, ou o visto em verde-folha quando o
 * passo está feito) e o fio até o próximo, como a linha do tempo da logo na vertical.
 */
function Step({ index, title, done, last = false, titleId, children }: StepProps) {
  const t = useTranslations('onboarding')
  return (
    <li className="relative flex gap-3.5 pb-5 last:pb-0">
      {!last && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-8 bottom-1 left-[0.9375rem] w-px transition-colors duration-200',
            done ? 'bg-leaf' : 'bg-border',
          )}
        />
      )}
      <span
        aria-hidden="true"
        className={cn(
          'relative z-10 flex size-[1.875rem] shrink-0 items-center justify-center rounded-full border font-medium font-mono text-xs tabular-nums transition-[background-color,border-color,color] duration-200 ease-out-soft',
          done
            ? 'border-transparent bg-leaf-gradient text-brand-deep'
            : 'border-border-strong/50 bg-popover text-muted-foreground',
        )}
      >
        {done ? <CheckIcon strokeWidth={3} className="size-3.5" /> : index}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <h3 className="font-medium text-sm">
          <span id={titleId}>{title}</span>
          {done && <span className="sr-only"> ({t('stepDone')})</span>}
        </h3>
        {children}
      </div>
    </li>
  )
}

/** Caixa de seleção num cartão clicável inteiro, que fica verde-folha quando marcado. */
function CheckCard({
  checked,
  onChange,
  children,
}: {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly children: ReactNode
}) {
  const id = useId()
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-[background-color,border-color] duration-150 ease-out-soft',
        checked ? 'border-leaf/50 bg-leaf-soft/50' : 'bg-popover hover:border-border-strong/50',
      )}
    >
      <Checkbox
        id={id}
        required
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-px"
      />
      <span className="text-pretty leading-relaxed">{children}</span>
    </label>
  )
}

/**
 * Onboarding do primeiro uso (e de cada versão nova dos Termos): aviso de que o provedor de IA
 * gratuito pode treinar com as perguntas, 18+, aceite da versão vigente e país de residência, em
 * passos numerados que se marcam conforme o usuário avança. O `POST /me/onboarding` devolve o
 * `/me` atualizado, e a guarda libera o app sem nova leitura.
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
  const done = [adult, terms, true].filter(Boolean).length
  const complete = adult && terms

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!complete) {
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <DialogHeader className="relative isolate gap-3 overflow-hidden bg-brand-gradient px-6 pt-6 pb-5 text-brand-foreground">
          <TekoLogo
            variant="seal"
            className="absolute -top-10 -right-10 -z-10 size-40 rotate-[-8deg] opacity-15"
          />
          <TekoLogo className="size-9 rounded-[0.6rem] ring-1 ring-white/20" />
          <DialogTitle className="font-semibold font-serif text-2xl text-brand-foreground">
            {kind === OnboardingKind.TermsUpdate ? t('titleTermsUpdate') : t('title')}
          </DialogTitle>
          <DialogDescription className="text-brand-foreground/85">
            {kind === OnboardingKind.TermsUpdate ? t('leadTermsUpdate') : t('lead')}
          </DialogDescription>
          <div className="flex items-center gap-3 pt-1">
            <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-leaf-gradient transition-[width] duration-200 ease-out-soft"
                style={{ width: `${Math.round((done / 3) * 100)}%` }}
              />
            </div>
            <p
              className="font-mono text-brand-foreground/85 text-xs tabular-nums"
              aria-live="polite"
            >
              {t('progress', { done, total: 3 })}
            </p>
          </div>
        </DialogHeader>

        <form onSubmit={submit} aria-busy={onboarding.isPending}>
          <div className="flex flex-col gap-5 px-6 py-5">
            <div className="flex gap-3 rounded-xl border border-accent-border/40 bg-accent/40 p-3.5">
              <SparklesIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-accent-foreground"
              />
              <div className="flex flex-col gap-1">
                <p className="font-medium">{t('training.title')}</p>
                <p className="text-pretty text-muted-foreground leading-relaxed">
                  {t('training.body')}
                </p>
              </div>
            </div>

            <ol aria-label={t('steps')} className="flex flex-col">
              <Step index={1} title={t('age')} done={adult}>
                <CheckCard checked={adult} onChange={setAdult}>
                  {t('adult')}
                </CheckCard>
              </Step>
              <Step index={2} title={t('termsStep')} done={terms}>
                <CheckCard checked={terms} onChange={setTerms}>
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
                </CheckCard>
              </Step>
              <Step index={3} title={t('country')} done last titleId={`${id}-country`}>
                <CountryPicker
                  labelId={`${id}-country`}
                  hintId={`${id}-country-hint`}
                  options={countries}
                  value={country}
                  onChange={setCountry}
                  disabled={onboarding.isPending}
                />
                <p id={`${id}-country-hint`} className="text-muted-foreground text-xs">
                  {t('countryHint')}
                </p>
              </Step>
            </ol>

            {error !== null && (
              <p
                role="alert"
                className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive"
              >
                <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {error instanceof ApiError ? tErrors(error.code) : tErrors('internal')}
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-surface px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
            {onSignOut !== undefined && (
              <Button type="button" variant="ghost" onClick={onSignOut} className="sm:mr-auto">
                {t('signOut')}
              </Button>
            )}
            <Button type="submit" size="lg" disabled={!complete || onboarding.isPending}>
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
