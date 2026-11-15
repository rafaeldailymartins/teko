'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { useFormatter, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { GetProvisionDiffResponse } from '@/lib/api/__generated__/types.gen'
import { useProvisionDiff } from '@/lib/api/hooks'
import { CALENDAR_DATE_FORMAT, calendarDate } from '@/lib/validity'
import { ValidityBadge } from './validity-badge.tsx'

type Diff = GetProvisionDiffResponse
type Side = Diff['before']

interface ProvisionDiffProps {
  readonly stableKey: string
  /** Data da redação de antes (a vigente nela). */
  readonly from: IsoDate
  /** Data da redação de depois; posterior a `from`. */
  readonly to: IsoDate
  /** Hoje (America/Sao_Paulo), para os badges; os testes fixam. */
  readonly today?: IsoDate
}

/** Houve mudança no texto ou em algum campo. */
function hasChanges(diff: Diff): boolean {
  return diff.fieldChanges.length > 0 || diff.segments.some((segment) => segment.op !== 'equal')
}

function SideSummary({
  title,
  side,
  today,
}: {
  readonly title: string
  readonly side: Side
  readonly today: IsoDate | undefined
}) {
  const t = useTranslations('provision.diff')
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border bg-surface p-3">
      <span className="font-medium text-muted-foreground text-xs">{title}</span>
      {side === null ? (
        <span className="text-sm">{t('absent')}</span>
      ) : (
        <>
          <span lang="pt-BR" className="font-medium text-sm">
            {side.label}
          </span>
          <ValidityBadge interval={side.validity} {...(today === undefined ? {} : { today })} />
        </>
      )}
    </div>
  )
}

/** Diff por palavra (inserções sublinhadas, remoções riscadas) e a tabela de campos que mudaram. */
function DiffBody({ diff }: { readonly diff: Diff }) {
  const t = useTranslations('provision.diff')
  if (!hasChanges(diff)) {
    return <p className="text-muted-foreground text-sm">{t('unchanged')}</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t('legend')}</p>
      <p lang="pt-BR" className="whitespace-pre-line font-serif text-[15px] leading-relaxed">
        {diff.segments.map((segment, index) => {
          // Os segmentos não têm id: a posição é a identidade (a lista nunca é reordenada).
          const key = `${index}-${segment.op}`
          if (segment.op === 'insert') {
            return (
              <ins
                key={key}
                className="rounded-sm bg-validity-current/15 text-foreground underline decoration-validity-current decoration-2"
              >
                <span className="sr-only">{t('insertedStart')}</span>
                {segment.text}
                <span className="sr-only">{t('insertedEnd')}</span>
              </ins>
            )
          }
          if (segment.op === 'delete') {
            return (
              <del
                key={key}
                className="rounded-sm bg-coverage-out/10 text-muted-foreground decoration-coverage-out decoration-2"
              >
                <span className="sr-only">{t('deletedStart')}</span>
                {segment.text}
                <span className="sr-only">{t('deletedEnd')}</span>
              </del>
            )
          }
          return <span key={key}>{segment.text}</span>
        })}
      </p>
      {diff.fieldChanges.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <caption className="pb-1 text-left font-medium text-muted-foreground text-xs">
            {t('fieldChanges')}
          </caption>
          <thead>
            <tr className="text-left text-muted-foreground text-xs">
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('field')}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('before')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('after')}
              </th>
            </tr>
          </thead>
          <tbody lang="pt-BR">
            {diff.fieldChanges.map((change) => (
              <tr key={change.field} className="border-t align-top">
                <th scope="row" className="py-1 pr-3 text-left font-medium">
                  {change.field}
                </th>
                <td className="py-1 pr-3 font-mono">{change.before ?? '—'}</td>
                <td className="py-1 font-mono">{change.after ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * "O que mudou" entre as redações vigentes em duas datas (`GET /provisions/:stableKey/diff`). Só
 * consulta a API quando é montado: quem o usa decide quando (sob demanda, num botão, ou na página
 * de comparação). Reutilizável no painel de citação do chat.
 */
export function ProvisionDiff({ stableKey, from, to, today }: ProvisionDiffProps) {
  const t = useTranslations('provision.diff')
  const tRoot = useTranslations()
  const format = useFormatter()
  const query = useProvisionDiff(stableKey, { referenceDate: from }, { referenceDate: to })
  const date = (value: IsoDate) => format.dateTime(calendarDate(value), CALENDAR_DATE_FORMAT)

  if (query.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm">
        <p className="text-muted-foreground">{tRoot(query.error.messageKey)}</p>
        {query.error.retryable && (
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t('retry')}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <SideSummary title={t('at', { date: date(from) })} side={query.data.before} today={today} />
        <SideSummary title={t('at', { date: date(to) })} side={query.data.after} today={today} />
      </div>
      <DiffBody diff={query.data} />
    </div>
  )
}
