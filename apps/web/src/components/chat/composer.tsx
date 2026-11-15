'use client'

import { QUESTION_MAX_LENGTH } from '@teko/shared/contracts'
import type { PiiKind } from '@teko/shared/pii'
import type { IsoDate } from '@teko/shared/vigencia'
import { ArrowUpIcon, ShieldAlertIcon, SquareIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type RefObject, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatIsoDate, formatPeriodo } from '@/lib/chat/format'
import { detectPii, removePii } from '@/lib/chat/pii'
import type { ReferenceChoice } from '@/lib/chat/reference'
import { isSubmitShortcut } from '@/lib/hotkeys'
import { ComposerCoverageBanner, CoverageIndicator } from './coverage.tsx'
import { ReferencePicker } from './reference-picker.tsx'

interface ComposerProps {
  readonly onSubmit: (text: string) => void
  readonly onStop: () => void
  /** Há uma resposta em andamento: o botão vira "Parar". */
  readonly busy: boolean
  /**
   * Cota estourada ou serviço pausado: mensagem com o reset, e nada é enviado. String vazia trava o
   * composer sem mensagem (quem trava mostra o motivo, como o onboarding).
   */
  readonly blockedMessage: string | null
  readonly reference: ReferenceChoice
  readonly referenceDate: IsoDate
  readonly onReferenceChange: (choice: ReferenceChoice) => void
  readonly pickerOpen: boolean
  readonly onPickerOpenChange: (open: boolean) => void
  /** Data que a última resposta inferiu do texto, para confirmar no chip. */
  readonly inferredDate: IsoDate | null
  readonly onConfirmInferred: (date: IsoDate) => void
  readonly today: IsoDate
  readonly shortcutLabel: string
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * Composer do chat: pergunta, chip da data de referência, indicador de cobertura e envio
 * (`Ctrl/⌘+Enter` ou botão). Antes de enviar, o detector de PII avisa e oferece trocar os dados
 * pelos marcadores; a cobertura só avisa, sem impedir o envio.
 */
export function Composer({
  onSubmit,
  onStop,
  busy,
  blockedMessage,
  reference,
  referenceDate,
  onReferenceChange,
  pickerOpen,
  onPickerOpenChange,
  inferredDate,
  onConfirmInferred,
  today,
  shortcutLabel,
  textareaRef,
}: ComposerProps) {
  const t = useTranslations('chat')
  const locale = useLocale()
  const hintId = useId()
  const piiId = useId()
  const [text, setText] = useState('')
  const [pii, setPii] = useState<readonly PiiKind[]>([])
  const blocked = blockedMessage !== null
  const canSend = !busy && !blocked && text.trim() !== ''

  function send(): void {
    onSubmit(text.trim())
    setText('')
    setPii([])
  }

  function submit(): void {
    if (!canSend) return
    const found = detectPii(text)
    if (found.length > 0) {
      setPii(found)
      return
    }
    send()
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border bg-background p-2 shadow-xs"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {blockedMessage !== null && blockedMessage !== '' && (
        <p role="alert" className="rounded-lg bg-muted px-3 py-2 text-sm">
          {blockedMessage}
        </p>
      )}
      <ComposerCoverageBanner date={referenceDate} />
      {inferredDate !== null && (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-border bg-accent px-3 py-1.5 text-accent-foreground text-sm">
          {t('reference.inferred', {
            value: inferredDate.endsWith('-01')
              ? formatPeriodo(inferredDate.slice(0, 7))
              : formatIsoDate(inferredDate, locale),
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onConfirmInferred(inferredDate)}
          >
            {t('reference.confirm')}
          </Button>
        </p>
      )}
      <label htmlFor={`${hintId}-input`} className="sr-only">
        {t('composer.label')}
      </label>
      <Textarea
        id={`${hintId}-input`}
        ref={textareaRef}
        value={text}
        maxLength={QUESTION_MAX_LENGTH}
        disabled={blocked}
        placeholder={t('composer.placeholder')}
        aria-describedby={pii.length > 0 ? `${hintId} ${piiId}` : hintId}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        className="max-h-60 min-h-12 resize-none border-0 shadow-none focus-visible:ring-0"
        onChange={(event) => {
          setText(event.target.value)
          setPii([])
        }}
        onKeyDown={(event) => {
          if (isSubmitShortcut(event)) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {pii.length > 0 && (
        <div
          id={piiId}
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-degraded px-3 py-2 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlertIcon aria-hidden="true" className="size-4 text-degraded" />
            {t('pii.title')}
          </p>
          <p>{t('pii.body', { kinds: pii.map((kind) => t(`pii.kinds.${kind}`)).join(', ') })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setText(removePii(text))
                setPii([])
              }}
            >
              {t('pii.remove')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={send}>
              {t('pii.sendAnyway')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ReferencePicker
            choice={reference}
            today={today}
            onChange={onReferenceChange}
            open={pickerOpen}
            onOpenChange={onPickerOpenChange}
            disabled={blocked}
          />
          <CoverageIndicator date={referenceDate} />
        </div>
        <div className="flex items-center gap-2">
          <span id={hintId} className="hidden text-muted-foreground text-xs sm:inline">
            {t('composer.hint', { shortcut: shortcutLabel })}
          </span>
          {busy ? (
            <Button type="button" variant="secondary" onClick={onStop} aria-keyshortcuts="Escape">
              <SquareIcon aria-hidden="true" />
              {t('composer.stop')}
            </Button>
          ) : (
            <Button type="submit" disabled={!canSend}>
              <ArrowUpIcon aria-hidden="true" />
              {t('composer.send')}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
