'use client'

import type { Locale } from '@teko/shared/i18n'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { useLocale, useTranslations } from 'next-intl'
import { formatValidityBounds } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'
import { ValidityStatus, validityStatus } from '@/lib/validity'

const TEXT_CLASSES: Record<ValidityStatus, string> = {
  [ValidityStatus.Current]: 'text-validity-current',
  [ValidityStatus.Superseded]: 'text-validity-superseded',
  [ValidityStatus.Future]: 'text-validity-future',
}

const BADGE_CLASSES: Record<ValidityStatus, string> = {
  [ValidityStatus.Current]: 'border-leaf/50 bg-leaf-soft',
  [ValidityStatus.Superseded]: 'border-validity-superseded/45 bg-popover',
  [ValidityStatus.Future]: 'border-validity-future/45 bg-popover',
}

/** Marcador da situação: o círculo da linha do tempo, cheio quando vigente. */
const DOT_CLASSES: Record<ValidityStatus, string> = {
  [ValidityStatus.Current]: 'bg-leaf',
  [ValidityStatus.Superseded]: 'border border-validity-superseded bg-transparent',
  [ValidityStatus.Future]: 'border border-validity-future bg-transparent',
}

/** Texto de um intervalo `[from, to)` ("04/11/2004 a 22/11/2009", "desde 23/11/2009"). */
export function useIntervalText(): (interval: ValidityInterval) => string {
  const t = useTranslations('chat.intervals')
  const locale = useLocale() as Locale
  return (interval) => {
    const { from, to } = formatValidityBounds(locale, interval)
    if (from !== null && to !== null) return t('range', { from, to })
    if (from !== null) return t('since', { from })
    if (to !== null) return t('until', { to })
    return t('always')
  }
}

interface ValidityBadgeProps {
  readonly interval: ValidityInterval
  readonly today: IsoDate
  /** `badge`: pílula com borda; `inline`: só o marcador e o texto, para listas compactas. */
  readonly variant?: 'badge' | 'inline'
  readonly className?: string
}

/** Situação de uma redação hoje (vigente, superada ou futura) e o intervalo de vigência dela. */
export function ValidityBadge({
  interval,
  today,
  variant = 'badge',
  className,
}: ValidityBadgeProps) {
  const t = useTranslations('chat.citation.status')
  const intervalText = useIntervalText()
  const status = validityStatus(interval, today)
  return (
    <span
      data-validity={status}
      className={cn(
        'inline-flex items-center gap-1.5 font-medium text-xs',
        TEXT_CLASSES[status],
        variant === 'badge' && cn('rounded-full border px-2 py-0.5', BADGE_CLASSES[status]),
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[status])}
      />
      <span>{t(status)}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono tabular-nums">{intervalText(interval)}</span>
    </span>
  )
}
