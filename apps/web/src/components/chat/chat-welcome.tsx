'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { useSession } from '@/components/auth/use-session'
import { TekoLogo } from '@/components/brand/teko-logo'
import {
  CORPUS_START_YEAR,
  corpusTimelinePosition,
  type ReferenceChoice,
  referenceDisplay,
} from '@/lib/chat/reference'
import { formatIsoDate, formatTaxPeriod } from '@/lib/i18n/format'

/** Parte do dia da saudação, pela hora local do navegador. */
type DayPeriod = 'morning' | 'afternoon' | 'evening'

function dayPeriod(hour: number): DayPeriod {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** Primeiro nome da conta (a saudação não usa o nome completo). */
function firstName(name: string | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  return first === undefined || first === '' ? null : first
}

interface ChatWelcomeProps {
  readonly reference: ReferenceChoice
  readonly today: IsoDate
  /** Abre o seletor da data de referência (o mesmo do chip do composer e do `Alt+D`). */
  readonly onChangeDate: () => void
  readonly disabled: boolean
}

/**
 * Abertura do chat vazio: o selo, a saudação (o `h1` da página sem conversa), o que o Tekó sabe
 * responder e a data de referência em destaque, como o ponto âmbar sobre o fio da linha do tempo do
 * corpus (de 1998 a hoje). O ponto anda quando a data muda; clicar nele abre o seletor.
 */
export function ChatWelcome({ reference, today, onChangeDate, disabled }: ChatWelcomeProps) {
  const t = useTranslations('chat.welcome')
  const tReference = useTranslations('chat.reference')
  const locale = useLocale()
  const { me } = useSession()
  const [period] = useState(() => dayPeriod(new Date().getHours()))
  const name = firstName(me?.name)
  const display = referenceDisplay(reference, today)
  const value =
    display.kind === 'periodo'
      ? formatTaxPeriod(locale, display.periodo)
      : formatIsoDate(locale, display.date, 'numeric')
  const date = display.kind === 'periodo' ? (`${display.periodo}-01` as IsoDate) : display.date
  const position = corpusTimelinePosition(date, today)
  const endYear = Number(today.slice(0, 4))

  return (
    <div className="flex flex-col items-center gap-5 text-center">
      <div className="relative">
        <span
          aria-hidden="true"
          className="absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--leaf)_22%,transparent),transparent)]"
        />
        <TekoLogo variant="seal" className="relative size-14 rounded-2xl shadow-raised" />
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <h1 className="text-balance font-semibold font-serif text-[1.75rem] leading-tight tracking-tight sm:text-[2.25rem]">
          {name === null
            ? t(`greeting.${period}`)
            : t('greetingNamed', { greeting: t(`greeting.${period}`), name })}
        </h1>
        <p className="max-w-xl text-pretty text-[0.9375rem] text-muted-foreground leading-relaxed sm:text-base">
          {t('lead')}
        </p>
      </div>
      <div className="flex w-full max-w-md flex-col items-center gap-2.5 pt-1">
        <p className="text-muted-foreground text-xs">{t('dateLead')}</p>
        <button
          type="button"
          onClick={onChangeDate}
          disabled={disabled}
          aria-keyshortcuts="Alt+D"
          data-welcome-date=""
          className="group/date inline-flex items-center gap-2 rounded-full border border-accent-border/70 bg-accent px-4 py-1.5 font-mono font-semibold text-accent-foreground text-base tabular-nums shadow-soft outline-none transition-[box-shadow,transform] duration-150 ease-out-soft hover:-translate-y-px hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60"
        >
          {value}
          {display.isDefault && (
            <span className="font-normal font-sans text-xs opacity-80">
              {tReference('defaultHint')}
            </span>
          )}
          <span className="sr-only">. {tReference('open')}</span>
        </button>
        <div aria-hidden="true" className="flex w-full items-center gap-2.5 pt-1">
          <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
            {CORPUS_START_YEAR}
          </span>
          <span className="timeline-rule relative h-px flex-1">
            <span
              className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-date-mark shadow-[0_0_0_3px_var(--background)] transition-[left] duration-250 ease-out-soft"
              style={{ left: `${(position * 100).toFixed(2)}%` }}
            />
          </span>
          <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
            {endYear}
          </span>
        </div>
      </div>
    </div>
  )
}
