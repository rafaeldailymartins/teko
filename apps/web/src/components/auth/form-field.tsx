'use client'

import { CircleAlertIcon, EyeIcon, EyeOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ComponentProps, type ReactNode, type Ref, useState } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface FormFieldProps extends Omit<ComponentProps<'input'>, 'id' | 'ref'> {
  readonly id: string
  readonly label: string
  /** Dica sob o campo (sempre visível, ligada por `aria-describedby`). */
  readonly hint?: ReactNode
  /** Mensagem de erro do campo; com ela o campo fica `aria-invalid`. */
  readonly error?: string | undefined
  /** Conteúdo à direita, dentro do campo (o botão de mostrar a senha). */
  readonly trailing?: ReactNode
  readonly inputRef?: Ref<HTMLInputElement>
}

/**
 * Campo com rótulo visível, dica e erro inline: o erro entra no `aria-describedby` e é anunciado
 * (`role="alert"` só quando aparece), e o campo ganha `aria-invalid` e a borda destrutiva.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  trailing,
  inputRef,
  className,
  ...props
}: FormFieldProps) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value) => value !== null)
    .join(' ')
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium text-sm">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy === '' ? undefined : describedBy}
          className={cn('h-11 px-3.5', trailing !== undefined && 'pr-11', className)}
          {...props}
        />
        {trailing !== undefined && (
          <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
        )}
      </div>
      {error !== undefined && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-destructive text-sm">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}
      {hint !== undefined && (
        <div id={hintId} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </div>
      )}
    </div>
  )
}

interface PasswordFieldProps extends Omit<FormFieldProps, 'type' | 'trailing'> {}

/** Campo de senha com o botão de mostrar e ocultar (o estado vai no `aria-pressed`). */
export function PasswordField(props: PasswordFieldProps) {
  const t = useTranslations('auth.email')
  const [visible, setVisible] = useState(false)
  return (
    <FormField
      {...props}
      type={visible ? 'text' : 'password'}
      spellCheck={false}
      autoCapitalize="none"
      trailing={
        <button
          type="button"
          aria-pressed={visible}
          aria-controls={props.id}
          aria-label={t('showPassword')}
          title={visible ? t('hidePassword') : t('showPassword')}
          onClick={() => setVisible((current) => !current)}
          className="flex size-9 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? (
            <EyeOffIcon aria-hidden="true" className="size-4" />
          ) : (
            <EyeIcon aria-hidden="true" className="size-4" />
          )}
        </button>
      }
    />
  )
}
