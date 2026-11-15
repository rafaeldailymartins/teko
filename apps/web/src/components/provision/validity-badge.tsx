'use client'

import { type IsoDate, lastIncludedDay, type ValidityInterval } from '@teko/shared/vigencia'
import { useFormatter, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  CALENDAR_DATE_FORMAT,
  calendarDate,
  todayIsoDate,
  ValidityStatus,
  validityStatus,
} from '@/lib/validity'

const STATUS_CLASSES: Readonly<Record<ValidityStatus, string>> = {
  [ValidityStatus.Current]: 'border-validity-current/40 text-validity-current',
  [ValidityStatus.Superseded]: 'border-validity-superseded/40 text-validity-superseded',
  [ValidityStatus.Future]: 'border-validity-future/40 text-validity-future',
}

interface ValidityBadgeProps {
  readonly interval: ValidityInterval
  /** Hoje (America/Sao_Paulo); os testes fixam. */
  readonly today?: IsoDate
  readonly className?: string
}

/**
 * Badge de intervalo de vigência `[from, to)`: o estado em relação a hoje (vigente, encerrada ou
 * futura, nas cores `--validity-*`) e as datas. O fim mostrado é o último dia de vigência, como se
 * lê na legislação ("de 12/09/2003 a 03/11/2004"), não o `to` exclusivo.
 */
export function ValidityBadge({ interval, today = todayIsoDate(), className }: ValidityBadgeProps) {
  const t = useTranslations('provision.validity')
  const format = useFormatter()
  const status = validityStatus(interval, today)
  const date = (value: IsoDate) => format.dateTime(calendarDate(value), CALENDAR_DATE_FORMAT)
  const lastDay = lastIncludedDay(interval)

  let range: string
  if (interval.from !== null && lastDay !== null) {
    range = t('between', { from: date(interval.from), to: date(lastDay) })
  } else if (interval.from !== null) {
    range = t('since', { from: date(interval.from) })
  } else if (lastDay !== null) {
    range = t('until', { to: date(lastDay) })
  } else {
    range = t('always')
  }

  return (
    <span
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2 rounded-full border px-2.5 py-0.5 font-medium text-xs',
        STATUS_CLASSES[status],
        className,
      )}
    >
      <span>{t(status)}</span>
      <span aria-hidden="true">·</span>
      <span className="font-mono tabular-nums">{range}</span>
    </span>
  )
}
