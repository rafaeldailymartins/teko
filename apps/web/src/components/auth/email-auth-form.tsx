'use client'

import {
  ACCOUNT_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@teko/shared/contracts'
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  ShieldAlertIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { EmailAuthError } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { useEmailSignIn, useEmailSignUp } from '@/lib/api/hooks'
import {
  EMAIL_FORM_FIELDS,
  type EmailFormErrors,
  EmailFormField,
  EmailFormMode,
  type EmailFormValues,
  emailFormRequest,
  passwordProgress,
  validateEmailForm,
} from '@/lib/auth/email-form'
import { localePagePath } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { FormField, PasswordField } from './form-field.tsx'

const EMPTY: EmailFormValues = { name: '', email: '', password: '' }

/** Limites que as mensagens de validação e de falha citam. */
const LIMITS = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH } as const

interface EmailAuthFormProps {
  /** Caminho de retorno já saneado (`safeReturnPath`). */
  readonly returnTo: string
  /** Outra forma de entrada em curso: o envio fica desabilitado. */
  readonly disabled?: boolean
}

/** Medidor da senha nova: enche até o mínimo e fica verde-folha quando chega lá. */
function PasswordMeter({ password }: { readonly password: string }) {
  const t = useTranslations('auth.email')
  const progress = passwordProgress(password)
  const done = progress >= 1
  return (
    <span className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2.5">
        <span aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
          <span
            className={cn(
              'block h-full rounded-full transition-[width,background-color] duration-200 ease-out-soft',
              done ? 'bg-leaf-gradient' : 'bg-border-strong/60',
            )}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 font-mono text-[0.6875rem] tabular-nums',
            done && 'text-validity-current',
          )}
        >
          {done && <CircleCheckIcon aria-hidden="true" className="size-3" />}
          {done
            ? t('passwordReady', { count: password.length })
            : t('passwordCount', { count: password.length, min: PASSWORD_MIN_LENGTH })}
        </span>
      </span>
      <span>{t('passwordHint', { min: PASSWORD_MIN_LENGTH })}</span>
    </span>
  )
}

/**
 * Entrar ou criar conta por e-mail e senha (ADR 0036), em abas que guardam o e-mail digitado. Os
 * campos são validados pelos schemas da API (`validateEmailForm`): o erro de um campo aparece
 * quando ele perde o foco com algo digitado ou no envio, e some assim que o valor fica válido. No
 * sucesso, o `/me` é relido e a página segue para o retorno.
 */
export function EmailAuthForm({ returnTo, disabled = false }: EmailAuthFormProps) {
  const t = useTranslations('auth.email')
  const tAuth = useTranslations('auth')
  const tErrors = useTranslations('errors')
  const locale = useLocale()
  const router = useRouter()
  const id = useId()
  const [mode, setMode] = useState<EmailFormMode>(EmailFormMode.SignIn)
  const [values, setValues] = useState<EmailFormValues>(EMPTY)
  const [shown, setShown] = useState<ReadonlySet<EmailFormField>>(new Set())
  const fieldRefs = useRef<Partial<Record<EmailFormField, HTMLInputElement | null>>>({})
  const signIn = useEmailSignIn()
  const signUp = useEmailSignUp()
  const mutation = mode === EmailFormMode.SignIn ? signIn : signUp

  const errors: EmailFormErrors = validateEmailForm(mode, values)
  const busy = mutation.isPending || mutation.isSuccess

  const show = (field: EmailFormField) =>
    setShown((current) => (current.has(field) ? current : new Set([...current, field])))

  const errorOf = (field: EmailFormField): string | undefined => {
    const issue = errors[field]
    return issue !== undefined && shown.has(field)
      ? t(`validation.${issue}`, { ...LIMITS, max: maxOf(field) })
      : undefined
  }

  const update = (field: EmailFormField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    mutation.reset()
  }

  const switchMode = (next: EmailFormMode) => {
    setMode(next)
    setShown(new Set())
    signIn.reset()
    signUp.reset()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = EMAIL_FORM_FIELDS[mode]
    setShown(new Set(fields))
    const invalid = fields.find((field) => errors[field] !== undefined)
    if (invalid !== undefined) {
      fieldRefs.current[invalid]?.focus()
      return
    }
    const request = emailFormRequest(values)
    const onSuccess = () => router.replace(returnTo)
    if (mode === EmailFormMode.SignIn) {
      signIn.mutate({ email: request.email, password: request.password }, { onSuccess })
    } else {
      signUp.mutate(request, { onSuccess })
    }
  }

  const describe = (error: Error): string => {
    if (error instanceof EmailAuthError) {
      return t(`failures.${error.failure}`, {
        ...LIMITS,
        max: error.failure === 'invalidName' ? ACCOUNT_NAME_MAX_LENGTH : PASSWORD_MAX_LENGTH,
      })
    }
    return error instanceof ApiError ? tErrors(error.code) : tAuth('errors.generic')
  }

  const termsLink = (chunks: ReactNode) => (
    <Link
      href={localePagePath(locale, 'terms')}
      className="font-medium text-primary underline underline-offset-4"
    >
      {chunks}
    </Link>
  )

  const signUpMode = mode === EmailFormMode.SignUp
  const field = (name: EmailFormField) => `${id}-${mode}-${name}`
  const bind = (name: EmailFormField) => ({
    id: field(name),
    value: values[name],
    error: errorOf(name),
    readOnly: busy,
    inputRef: (element: HTMLInputElement | null) => {
      fieldRefs.current[name] = element
    },
    onChange: (event: { readonly target: HTMLInputElement }) => update(name)(event.target.value),
    onBlur: (event: { readonly relatedTarget: EventTarget | null }) => {
      // Indo para o envio, o erro sai no submit: aparecer agora empurraria o botão sob o clique.
      const toSubmit =
        event.relatedTarget instanceof HTMLButtonElement && event.relatedTarget.type === 'submit'
      if (values[name] !== '' && !toSubmit) show(name)
    },
  })

  const form = (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4" aria-busy={busy}>
      {signUpMode && (
        <FormField
          {...bind(EmailFormField.Name)}
          label={t('name')}
          autoComplete="name"
          placeholder={t('namePlaceholder')}
        />
      )}
      <FormField
        {...bind(EmailFormField.Email)}
        label={t('email')}
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('emailPlaceholder')}
      />
      <PasswordField
        {...bind(EmailFormField.Password)}
        label={t('password')}
        autoComplete={signUpMode ? 'new-password' : 'current-password'}
        hint={signUpMode ? <PasswordMeter password={values.password} /> : undefined}
      />

      {mutation.error !== null && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <span>{describe(mutation.error)}</span>
        </p>
      )}

      {signUpMode && (
        <p className="flex gap-2.5 rounded-lg border border-accent-border/40 bg-accent/40 p-3 text-xs leading-relaxed">
          <ShieldAlertIcon
            aria-hidden="true"
            className="mt-px size-4 shrink-0 text-accent-foreground"
          />
          <span>{t.rich('notice', { terms: termsLink })}</span>
        </p>
      )}

      <Button type="submit" size="lg" disabled={disabled || busy}>
        {busy ? (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        ) : (
          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" className="order-last" />
        )}
        {busy
          ? t(signUpMode ? 'signingUp' : 'signingIn')
          : t(signUpMode ? 'submitSignUp' : 'submitSignIn')}
      </Button>

      {!signUpMode && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t.rich('forgot', { terms: termsLink })}
        </p>
      )}
    </form>
  )

  return (
    <Tabs
      value={mode}
      onValueChange={(value) =>
        switchMode(value === EmailFormMode.SignUp ? EmailFormMode.SignUp : EmailFormMode.SignIn)
      }
    >
      <TabsList aria-label={t('tabs')}>
        <TabsTab value={EmailFormMode.SignIn}>{t('signIn')}</TabsTab>
        <TabsTab value={EmailFormMode.SignUp}>{t('signUp')}</TabsTab>
      </TabsList>
      <TabsPanel value={EmailFormMode.SignIn}>{signUpMode ? null : form}</TabsPanel>
      <TabsPanel value={EmailFormMode.SignUp}>{signUpMode ? form : null}</TabsPanel>
    </Tabs>
  )
}

/** Teto citado pela mensagem de cada campo. */
function maxOf(field: EmailFormField): number {
  return field === EmailFormField.Name ? ACCOUNT_NAME_MAX_LENGTH : PASSWORD_MAX_LENGTH
}
