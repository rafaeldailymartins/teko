'use client'

import { QUESTION_MAX_LENGTH } from '@teko/shared/contracts'
import type { PiiKind } from '@teko/shared/pii'
import type { IsoDate } from '@teko/shared/vigencia'
import { ArrowUpIcon, ClockIcon, ShieldAlertIcon, SquareIcon, WandSparklesIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type RefObject, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Textarea } from '@/components/ui/textarea'
import { detectPii, removePii } from '@/lib/chat/pii'
import type { ReferenceChoice } from '@/lib/chat/reference'
import { isSubmitShortcut } from '@/lib/hotkeys'
import { formatIsoDate, formatTaxPeriod } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'
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
  /** Teclas do atalho de envio, separadas por espaço ("Ctrl Enter", "⌘ Enter"). */
  readonly shortcutLabel: string
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>
}

/** A partir de quanto do limite o contador aparece em tom de alerta. */
const COUNTER_WARNING = 0.9

/**
 * Composer do chat num bloco só: a pergunta, e embaixo o chip da data de referência, o indicador de
 * cobertura, o contador, o atalho e o botão redondo de enviar (`Ctrl/⌘+Enter`), que vira "Parar"
 * durante a resposta. Avisos (cota, cobertura, data inferida, dados pessoais) entram no topo do
 * bloco. Antes de enviar, o detector de PII avisa e oferece trocar os dados pelos marcadores; a
 * cobertura só avisa, sem impedir o envio.
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
  const count = text.length
  const nearLimit = count >= QUESTION_MAX_LENGTH * COUNTER_WARNING

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
      className={cn(
        'flex flex-col rounded-2xl border border-border-strong/35 bg-popover shadow-raised transition-[border-color,box-shadow] duration-200 ease-out-soft',
        'focus-within:border-ring focus-within:shadow-[var(--shadow-raised),0_0_0_3px_color-mix(in_oklch,var(--ring)_18%,transparent)]',
        blocked && 'bg-surface',
      )}
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      {blockedMessage !== null && blockedMessage !== '' && (
        <p
          role="alert"
          className="m-2 mb-0 flex items-start gap-2 rounded-xl border border-degraded/40 bg-popover px-3 py-2 text-sm"
        >
          <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-degraded" />
          {blockedMessage}
        </p>
      )}
      <ComposerCoverageBanner date={referenceDate} />
      {inferredDate !== null && (
        <p className="m-2 mb-0 flex flex-wrap items-center gap-2 rounded-xl border border-accent-border/60 bg-accent px-3 py-1.5 text-accent-foreground text-sm">
          <WandSparklesIcon aria-hidden="true" className="size-4 shrink-0" />
          <span className="tabular-nums">
            {t('reference.inferred', {
              value: inferredDate.endsWith('-01')
                ? formatTaxPeriod(locale, inferredDate.slice(0, 7))
                : formatIsoDate(locale, inferredDate, 'numeric'),
            })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto h-7"
            onClick={() => onConfirmInferred(inferredDate)}
          >
            {t('reference.confirm')}
          </Button>
        </p>
      )}
      {pii.length > 0 && (
        <div
          id={piiId}
          role="alert"
          className="m-2 mb-0 flex flex-col gap-2 rounded-xl border border-degraded/50 bg-popover px-3 py-2.5 text-sm"
        >
          <p className="flex items-center gap-2 font-medium">
            <ShieldAlertIcon aria-hidden="true" className="size-4 text-degraded" />
            {t('pii.title')}
          </p>
          <p className="text-muted-foreground">
            {t('pii.body', { kinds: pii.map((kind) => t(`pii.kinds.${kind}`)).join(', ') })}
          </p>
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
        rows={1}
        className="max-h-60 min-h-[3.25rem] resize-none rounded-none border-0 bg-transparent px-4 pt-3.5 pb-1 text-[16px] leading-relaxed shadow-none focus-visible:border-0 focus-visible:ring-0 disabled:opacity-60 md:text-[16px]"
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
      <div className="flex items-center gap-2 px-2.5 pt-1 pb-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {count > 0 && (
            <span
              className={cn(
                'hidden font-mono text-xs tabular-nums sm:inline',
                nearLimit ? 'text-degraded' : 'text-muted-foreground',
              )}
              data-composer-counter=""
            >
              {t('composer.counter', { count, max: QUESTION_MAX_LENGTH })}
            </span>
          )}
          <span
            id={hintId}
            className="hidden items-center gap-1 text-muted-foreground text-xs md:inline-flex"
          >
            {(busy ? 'Esc' : shortcutLabel).split(' ').map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
            <span className="ml-0.5">{busy ? t('composer.hintStop') : t('composer.hintSend')}</span>
          </span>
          {busy ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={onStop}
              aria-keyshortcuts="Escape"
              aria-label={t('composer.stop')}
              className="rounded-full"
            >
              <SquareIcon aria-hidden="true" className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label={t('composer.send')}
              className="rounded-full"
            >
              <ArrowUpIcon aria-hidden="true" className="size-[1.125rem]" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
