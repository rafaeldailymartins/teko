'use client'

import {
  DatabaseIcon,
  DownloadIcon,
  FileJsonIcon,
  LoaderCircleIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { EXPORT_FILENAME } from '@/lib/api/account'
import { ApiError } from '@/lib/api/errors'
import { useDeleteAccount, useExportMyData } from '@/lib/api/hooks'
import { navigateTo } from '@/lib/browser'
import { downloadJson } from '@/lib/download'
import { localeHomePath } from '@/lib/i18n/routing'
import { SectionError, SectionStatus, SettingsSection } from './settings-section.tsx'

function useErrorMessage(): (error: Error) => string {
  const tErrors = useTranslations('errors')
  return (error) => (error instanceof ApiError ? tErrors(error.code) : tErrors('internal'))
}

/** Confirmação digitada: a palavra precisa bater, sem diferenciar maiúsculas nem espaços nas pontas. */
function matchesConfirmation(typed: string, word: string): boolean {
  return typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase()
}

/** Diálogo de exclusão da conta: só habilita o botão depois da palavra de confirmação digitada. */
function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('settings.delete')
  const locale = useLocale()
  const id = useId()
  const describe = useErrorMessage()
  const deletion = useDeleteAccount()
  const [typed, setTyped] = useState('')
  const word = t('word')
  const confirmed = matchesConfirmation(typed, word)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!confirmed) {
      return
    }
    // A resposta apaga o cookie; a navegação completa descarta o cache da conta apagada.
    deletion.mutate(undefined, {
      onSuccess: () => navigateTo(localeHomePath(locale)),
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!deletion.isPending) {
          setTyped('')
          deletion.reset()
          onOpenChange(next)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-semibold font-serif text-xl">{t('title')}</DialogTitle>
          <DialogDescription>{t('body')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-confirm`} className="font-medium">
              {t('confirmLabel', { word })}
            </label>
            <Input
              id={`${id}-confirm`}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          {deletion.error !== null && <SectionError>{describe(deletion.error)}</SectionError>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              disabled={deletion.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!confirmed || deletion.isPending}>
              {deletion.isPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              {deletion.isPending ? t('deleting') : t('confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Direito do titular à portabilidade: exportar tudo em JSON (`GET /me/export`). */
export function DataSection() {
  const t = useTranslations('settings.data')
  const describe = useErrorMessage()
  const exporting = useExportMyData()

  return (
    <SettingsSection id="data" title={t('title')} description={t('lead')} icon={DatabaseIcon}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 font-mono text-muted-foreground text-xs">
          <FileJsonIcon aria-hidden="true" className="size-4 text-validity-current" />
          {EXPORT_FILENAME}
        </p>
        <Button
          variant="outline"
          disabled={exporting.isPending}
          onClick={() =>
            exporting.mutate(undefined, {
              onSuccess: ({ filename, data }) => downloadJson(filename, data),
            })
          }
        >
          {exporting.isPending ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          {exporting.isPending ? t('exporting') : t('export')}
        </Button>
      </div>
      {exporting.error !== null && <SectionError>{describe(exporting.error)}</SectionError>}
      {exporting.isSuccess && <SectionStatus>{t('exported')}</SectionStatus>}
    </SettingsSection>
  )
}

/** Direito do titular à eliminação (`DELETE /me`), separada na zona de perigo. */
export function DangerSection() {
  const t = useTranslations('settings.danger')
  const tDelete = useTranslations('settings.delete')
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <SettingsSection id="danger" title={t('title')} icon={TriangleAlertIcon} tone="danger">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-pretty text-muted-foreground text-sm">{tDelete('body')}</p>
        <Button variant="destructive" className="shrink-0" onClick={() => setDeleteOpen(true)}>
          <Trash2Icon aria-hidden="true" />
          {tDelete('button')}
        </Button>
      </div>
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </SettingsSection>
  )
}
