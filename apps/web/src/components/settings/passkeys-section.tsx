'use client'

import { FingerprintIcon, KeyRoundIcon, LoaderCircleIcon, Trash2Icon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasskeyError } from '@/lib/api/auth'
import { ApiError } from '@/lib/api/errors'
import { useDeletePasskey, usePasskeys, useRegisterPasskey } from '@/lib/api/hooks'
import { SectionError, SectionStatus, SettingsSection } from './settings-section.tsx'

/**
 * Passkeys da conta: lista, cadastro (com nome opcional) e remoção, pelas rotas do plugin de
 * passkey do Better Auth. Passkey vale por host (`rpID`): no Plano B é preciso cadastrar de novo.
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
    <SettingsSection id="passkeys" title={t('title')} description={t('lead')}>
      {passkeys.isPending ? (
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      ) : passkeys.data !== undefined && passkeys.data.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border bg-background">
          {passkeys.data.map((passkey) => {
            const label = passkey.name ?? t('unnamed')
            return (
              <li key={passkey.id} className="flex items-center gap-3 px-3 py-2">
                <KeyRoundIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{label}</p>
                  <p className="text-muted-foreground text-xs">
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
        passkeys.data !== undefined && <p className="text-muted-foreground text-sm">{t('empty')}</p>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
