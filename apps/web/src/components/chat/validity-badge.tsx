'use client'

import type { Locale } from '@teko/shared/i18n'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { useLocale, useTranslations } from 'next-intl'
import { intervalDisplay, ValidityStatus, validityStatus } from '@/lib/chat/format'
import { cn } from '@/lib/utils'

const STATUS_CLASSES: Record<ValidityStatus, string> = {
  [ValidityStatus.Current]: 'border-validity-current text-validity-current',
  [ValidityStatus.Superseded]: 'border-validity-superseded text-validity-superseded',
  [ValidityStatus.Future]: 'border-validity-future text-validity-future',
}

/** Texto de um intervalo `[from, to)` ("04/11/2004 a 22/11/2009", "desde 23/11/2009"). */
export function useIntervalText(): (interval: ValidityInterval) => string {
  const t = useTranslations('chat.intervals')
  const locale = useLocale() as Locale
  return (interval) => {
    const { from, to } = intervalDisplay(interval, locale)
    if (from !== null && to !== null) return t('range', { from, to })
    if (from !== null) return t('since', { from })
    if (to !== null) return t('until', { to })
    return t('always')
  }
}

interface ValidityBadgeProps {
  readonly interval: ValidityInterval
  readonly today: IsoDate
  readonly className?: string
}

/** Badge do intervalo de vigência de uma redação, na cor da situação dela hoje. */
export function ValidityBadge({ interval, today, className }: ValidityBadgeProps) {
  const t = useTranslations('chat.citation.status')
  const intervalText = useIntervalText()
  const status = validityStatus(interval, today)
  return (
    <span
      data-validity={status}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-medium text-xs tabular-nums',
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span>{t(status)}</span>
      <span aria-hidden="true">·</span>
      <span>{intervalText(interval)}</span>
    </span>
  )
}
