'use client'

import {
  type IsoDate,
  isIsoDate,
  type PeriodoApuracao,
  toCalendarDate,
} from '@teko/shared/vigencia'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { type ReferenceChoice, referenceDisplay, referencePresets } from '@/lib/chat/reference'
import { formatIsoDate, formatMonthName, formatTaxPeriod } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'

interface ReferencePickerProps {
  readonly choice: ReferenceChoice
  readonly today: IsoDate
  readonly onChange: (choice: ReferenceChoice) => void
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly disabled?: boolean
}

const MONTHS = Array.from({ length: 12 }, (_, index) => index + 1)

function periodoOf(year: number, month: number): PeriodoApuracao {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
}

/**
 * Chip fixo da data de referência no composer ("Período de apuração: 03/2024") com o seletor:
 * grade de meses com navegação por ano, alternância para data exata, atalhos (mês anterior, mês
 * atual, último período fechado) e volta ao padrão. Abre também por `Alt+D`.
 */
export function ReferencePicker({
  choice,
  today,
  onChange,
  open,
  onOpenChange,
  disabled,
}: ReferencePickerProps) {
  const t = useTranslations('chat.reference')
  const locale = useLocale()
  const display = referenceDisplay(choice, today)
  const presets = referencePresets(today)
  const dateInputId = useId()
  const [mode, setMode] = useState<'periodo' | 'date'>(display.kind)
  const shownYear = toCalendarDate(
    display.kind === 'periodo' ? `${display.periodo}-01` : display.date,
  ).year
  const [year, setYear] = useState(shownYear)
  const [draftDate, setDraftDate] = useState(display.kind === 'date' ? display.date : today)
  // Ao abrir (pelo chip ou pelo Alt+D, que abre de fora), o seletor volta ao modo e ao ano da data
  // escolhida. Ajuste de estado durante o render, sem efeito: só quando `open` muda.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setMode(display.kind)
      setYear(shownYear)
    }
  }

  const label =
    display.kind === 'periodo'
      ? t('chipPeriodo', { value: formatTaxPeriod(locale, display.periodo) })
      : t('chipDate', { value: formatIsoDate(locale, display.date, 'numeric') })
  const selectedPeriodo = choice?.periodoApuracao ?? null

  function choose(next: ReferenceChoice): void {
    onChange(next)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" />}
        disabled={disabled}
        aria-keyshortcuts="Alt+D"
        title={t('open')}
        data-reference-chip=""
        className="border-accent-border bg-accent text-accent-foreground hover:bg-accent/80"
      >
        <CalendarIcon aria-hidden="true" />
        <span className="tabular-nums">{label}</span>
        {display.isDefault && (
          <span className="font-normal text-xs opacity-80">({t('defaultHint')})</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverTitle>{t('title')}</PopoverTitle>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {(['periodo', 'date'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'h-7 rounded-md text-sm transition-colors',
                mode === value ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground',
              )}
            >
              {value === 'periodo' ? t('modePeriodo') : t('modeDate')}
            </button>
          ))}
        </div>

        {mode === 'periodo' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('previousYear')}
                onClick={() => setYear((value) => value - 1)}
              >
                <ChevronLeftIcon aria-hidden="true" />
              </Button>
              <span className="font-medium tabular-nums" aria-live="polite">
                {year}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('nextYear')}
                onClick={() => setYear((value) => value + 1)}
              >
                <ChevronRightIcon aria-hidden="true" />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {MONTHS.map((month) => {
                const periodo = periodoOf(year, month)
                return (
                  <button
                    key={periodo}
                    type="button"
                    aria-pressed={selectedPeriodo === periodo}
                    aria-label={formatTaxPeriod(locale, periodo)}
                    data-periodo={periodo}
                    onClick={() => choose({ periodoApuracao: periodo })}
                    className={cn(
                      'h-8 rounded-md text-sm capitalize transition-colors hover:bg-muted',
                      selectedPeriodo === periodo &&
                        'bg-primary text-primary-foreground hover:bg-primary/85',
                    )}
                  >
                    {formatMonthName(locale, month)}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (isIsoDate(draftDate)) choose({ referenceDate: draftDate })
            }}
          >
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={dateInputId} className="text-muted-foreground text-xs">
                {t('dateLabel')}
              </label>
              <input
                id={dateInputId}
                type="date"
                required
                min="1998-01-01"
                value={draftDate}
                onChange={(event) => setDraftDate(event.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm tabular-nums"
              />
            </div>
            <Button type="submit" size="sm">
              {t('apply')}
            </Button>
          </form>
        )}

        <div className="flex flex-col gap-1 border-t pt-2">
          <span className="text-muted-foreground text-xs">{t('presets')}</span>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => choose({ periodoApuracao: presets.previousMonth })}
            >
              {t('presetPrevious')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => choose({ periodoApuracao: presets.currentMonth })}
            >
              {t('presetCurrent')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => choose({ periodoApuracao: presets.lastClosed })}
            >
              {t('presetLastClosed')}
            </Button>
            {choice !== null && (
              <Button variant="ghost" size="sm" onClick={() => choose(null)}>
                {t('useDefault')}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
