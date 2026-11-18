'use client'

import { FingerprintIcon, KeyRoundIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { PasskeyError } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { useDeletePasskey, usePasskeys, useRegisterPasskey } from '@/lib/api/hooks'
import { SectionError, SectionStatus, SettingsSection } from './settings-section.tsx'

/**
 * Passkeys da conta: lista, cadastro (com nome opcional) e remoção, pelas rotas do plugin de
 * passkey do Better Auth. Passkey vale por host (`rpID`).
 */
export function PasskeysSection() {
  const t = useTranslations('settings.passkeys')
  const tPasskey = useTranslations('auth.passkey')
  const tErrors = useTranslations('errors')
  const format = useFormatter()
  const id = useId()
  const passkeys = usePasskeys()
  const register = useRegisterPasskey()
  const remove = useDeletePasskey()
  const [name, setName] = useState('')
  const [done, setDone] = useState<'added' | 'removed' | null>(null)

  const describe = (error: Error): string => {
    if (error instanceof PasskeyError) {
      return tPasskey(error.failure)
    }
    return error instanceof ApiError ? tErrors(error.code) : tErrors('internal')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setDone(null)
    remove.reset()
    register.mutate(name, {
      onSuccess: () => {
        setName('')
        setDone('added')
      },
    })
  }

  const busy = register.isPending || remove.isPending
  const failure = register.error ?? remove.error ?? passkeys.error

  return (
    <SettingsSection id="passkeys" title={t('title')} description={t('lead')} icon={KeyRoundIcon}>
      {passkeys.isPending ? (
        <div className="flex flex-col gap-2" role="status" aria-label={t('loading')}>
          <Skeleton className="h-14 rounded-xl" />
        </div>
      ) : passkeys.data !== undefined && passkeys.data.length > 0 ? (
        <ul className="flex flex-col divide-y overflow-hidden rounded-xl border bg-surface/60">
          {passkeys.data.map((passkey) => {
            const label = passkey.name ?? t('unnamed')
            return (
              <li key={passkey.id} className="flex items-center gap-3 px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-popover text-primary shadow-soft"
                >
                  <FingerprintIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{label}</p>
                  <p className="font-mono text-muted-foreground text-xs tabular-nums">
                    {t('createdAt', {
                      date: format.dateTime(passkey.createdAt, { dateStyle: 'short' }),
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('removeLabel', { name: label })}
                  disabled={busy}
                  className="hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => {
                    setDone(null)
                    register.reset()
                    remove.mutate(passkey.id, { onSuccess: () => setDone('removed') })
                  }}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        passkeys.data !== undefined && (
          <p className="flex items-center gap-3 rounded-xl border border-dashed bg-surface/40 px-4 py-3.5 text-muted-foreground text-sm">
            <FingerprintIcon aria-hidden="true" className="size-5 shrink-0 text-validity-current" />
            {t('empty')}
          </p>
        )
      )}

      <form onSubmit={submit} className="flex flex-col gap-2.5 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="font-medium text-sm">
            {t('nameLabel')}
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            maxLength={64}
            autoComplete="off"
            placeholder={t('namePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          {register.isPending ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <FingerprintIcon aria-hidden="true" />
          )}
          {register.isPending ? t('adding') : t('add')}
        </Button>
      </form>

      {failure !== null && <SectionError>{describe(failure)}</SectionError>}
      {done !== null && <SectionStatus>{t(done)}</SectionStatus>}
    </SettingsSection>
  )
}
