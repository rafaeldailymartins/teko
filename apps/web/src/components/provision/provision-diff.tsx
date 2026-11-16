'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { ArrowDownIcon, ArrowRightIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { QueryError } from '@/components/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { analytics } from '@/lib/analytics'
import type { GetProvisionDiffResponse } from '@/lib/api/__generated__/types.gen'
import { useProvisionDiff } from '@/lib/api/hooks'
import { formatIsoDate } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'
import { ValidityBadge } from './validity-badge.tsx'

type Diff = GetProvisionDiffResponse
type Side = Diff['before']
type Segment = Diff['segments'][number]

/**
 * `inline`: as duas redações resumidas em cima e um texto só, com o que entrou e o que saiu marcados
 * (painel de citação, página de dispositivo). `split`: antes e depois lado a lado no desktop e
 * empilhados no celular, cada coluna com a própria redação (página de comparação).
 */
type DiffLayout = 'inline' | 'split'

interface ProvisionDiffProps {
  readonly stableKey: string
  /** Data da redação de antes (a vigente nela). */
  readonly from: IsoDate
  /** Data da redação de depois; posterior a `from`. */
  readonly to: IsoDate
  /** Hoje (America/Sao_Paulo), para os badges; os testes fixam. */
  readonly today?: IsoDate
  readonly layout?: DiffLayout
}

/** Houve mudança no texto ou em algum campo. */
function hasChanges(diff: Diff): boolean {
  return diff.fieldChanges.length > 0 || diff.segments.some((segment) => segment.op !== 'equal')
}

const INSERT_CLASSES =
  'rounded-[0.2rem] bg-leaf-soft px-0.5 text-validity-current no-underline shadow-[inset_0_-2px_0_color-mix(in_oklch,var(--leaf)_70%,transparent)] [box-decoration-break:clone]'
const DELETE_CLASSES =
  'rounded-[0.2rem] bg-muted px-0.5 text-coverage-out line-through decoration-coverage-out/70 decoration-[1.5px] [box-decoration-break:clone]'

/** Os segmentos não têm id: a posição é a identidade (a lista nunca é reordenada). */
function segmentKey(segment: Segment, index: number): string {
  return `${index}-${segment.op}`
}

function SegmentText({ segment }: { readonly segment: Segment }) {
  const t = useTranslations('provision.diff')
  if (segment.op === 'insert') {
    return (
      <ins className={INSERT_CLASSES}>
        <span className="sr-only">{t('insertedStart')}</span>
        {segment.text}
        <span className="sr-only">{t('insertedEnd')}</span>
      </ins>
    )
  }
  if (segment.op === 'delete') {
    return (
      <del className={DELETE_CLASSES}>
        <span className="sr-only">{t('deletedStart')}</span>
        {segment.text}
        <span className="sr-only">{t('deletedEnd')}</span>
      </del>
    )
  }
  return <span>{segment.text}</span>
}

const TEXT_CLASSES = 'whitespace-pre-line font-serif text-[16px] leading-[1.75]'

function SideSummary({
  title,
  side,
  today,
  className,
}: {
  readonly title: string
  readonly side: Side
  readonly today: IsoDate | undefined
  readonly className?: string
}) {
  const t = useTranslations('provision.diff')
  return (
    <div className={cn('flex flex-col items-start gap-1.5', className)}>
      <span className="inline-flex items-center gap-1.5 font-medium font-mono text-accent-foreground text-xs tabular-nums">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-date-mark" />
        {title}
      </span>
      {side === null ? (
        <span className="text-muted-foreground text-sm">{t('absent')}</span>
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

/** Legenda com as próprias marcas: o que entrou e o que saiu. */
function Legend() {
  const t = useTranslations('provision.diff')
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      <span>{t('legend')}</span>
      <span aria-hidden="true" className="inline-flex items-center gap-2 font-serif text-sm">
        <span className={INSERT_CLASSES}>{t('legendInserted')}</span>
        <span className={DELETE_CLASSES}>{t('legendDeleted')}</span>
      </span>
    </p>
  )
}

function FieldChanges({ diff }: { readonly diff: Diff }) {
  const t = useTranslations('provision.diff')
  if (diff.fieldChanges.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-xl border bg-popover">
      <table className="w-full border-collapse text-sm">
        <caption className="px-3.5 pt-3 pb-1 text-left font-medium text-muted-foreground text-xs">
          {t('fieldChanges')}
        </caption>
        <thead>
          <tr className="text-left text-muted-foreground text-xs">
            <th scope="col" className="px-3.5 py-1.5 font-medium">
              {t('field')}
            </th>
            <th scope="col" className="px-3.5 py-1.5 font-medium">
              {t('before')}
            </th>
            <th scope="col" className="px-3.5 py-1.5 font-medium">
              {t('after')}
            </th>
          </tr>
        </thead>
        <tbody lang="pt-BR">
          {diff.fieldChanges.map((change) => (
            <tr key={change.field} className="border-t align-top">
              <th scope="row" className="px-3.5 py-1.5 text-left font-medium">
                {change.field}
              </th>
              <td className="px-3.5 py-1.5 font-mono text-coverage-out">{change.before ?? '—'}</td>
              <td className="px-3.5 py-1.5 font-mono text-validity-current">
                {change.after ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface DiffViewProps {
  readonly diff: Diff
  readonly from: string
  readonly to: string
  readonly today: IsoDate | undefined
}

/** Resumos das duas redações com a seta entre elas, e o texto único com as marcas. */
function InlineDiff({ diff, from, to, today }: DiffViewProps) {
  const t = useTranslations('provision.diff')
  const changed = hasChanges(diff)
  return (
    <div className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-xl border bg-surface p-3.5 @md:flex-row @md:items-start">
        <SideSummary title={from} side={diff.before} today={today} className="flex-1" />
        <ArrowRightIcon
          aria-hidden="true"
          className="hidden size-4 shrink-0 self-center text-muted-foreground @md:block"
        />
        <ArrowDownIcon
          aria-hidden="true"
          className="size-4 shrink-0 self-center text-muted-foreground @md:hidden"
        />
        <SideSummary title={to} side={diff.after} today={today} className="flex-1" />
      </div>
      {changed ? (
        <>
          <Legend />
          <p lang="pt-BR" className={TEXT_CLASSES}>
            {diff.segments.map((segment, index) => (
              <SegmentText key={segmentKey(segment, index)} segment={segment} />
            ))}
          </p>
          <FieldChanges diff={diff} />
        </>
      ) : (
        <p className="text-muted-foreground text-sm">{t('unchanged')}</p>
      )}
    </div>
  )
}

/**
 * Antes e depois lado a lado (empilhados no celular): a coluna de antes mostra o texto com as
 * remoções; a de depois, com as inclusões. O texto igual aparece nas duas.
 */
function SplitDiff({ diff, from, to, today }: DiffViewProps) {
  const t = useTranslations('provision.diff')
  const changed = hasChanges(diff)
  const columns = [
    { key: 'before', title: from, side: diff.before, skip: 'insert' },
    { key: 'after', title: to, side: diff.after, skip: 'delete' },
  ] as const
  return (
    <div className="flex flex-col gap-4">
      {changed ? <Legend /> : <p className="text-muted-foreground text-sm">{t('unchanged')}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {columns.map((column) => (
          <section
            key={column.key}
            aria-label={column.title}
            data-diff-side={column.key}
            className="flex flex-col gap-4 rounded-xl border bg-popover p-4 shadow-soft"
          >
            <SideSummary title={column.title} side={column.side} today={today} />
            {column.side !== null && (
              <p lang="pt-BR" className={cn(TEXT_CLASSES, 'border-t pt-4')}>
                {diff.segments.map((segment, index) =>
                  segment.op === column.skip ? null : (
                    <SegmentText key={segmentKey(segment, index)} segment={segment} />
                  ),
                )}
              </p>
            )}
          </section>
        ))}
      </div>
      <FieldChanges diff={diff} />
    </div>
  )
}

/**
 * "O que mudou" entre as redações vigentes em duas datas (`GET /provisions/:stableKey/diff`). Só
 * consulta a API quando é montado: quem o usa decide quando (sob demanda, num botão, ou na página
 * de comparação). Inserções em verde-folha, remoções riscadas. Reutilizável no painel de citação
 * do chat.
 */
export function ProvisionDiff({
  stableKey,
  from,
  to,
  today,
  layout = 'inline',
}: ProvisionDiffProps) {
  const t = useTranslations('provision.diff')
  const locale = useLocale()
  const query = useProvisionDiff(stableKey, { referenceDate: from }, { referenceDate: to })
  // Um `diff_opened` por diff montado (sem o dispositivo nem as datas).
  useEffect(() => {
    analytics.capture('diff_opened', {})
  }, [])
  const date = (value: IsoDate) => t('at', { date: formatIsoDate(locale, value, 'numeric') })

  if (query.isPending) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">{t('loading')}</span>
        <div className={cn('grid gap-3', layout === 'split' && 'lg:grid-cols-2')}>
          <Skeleton className="h-24 w-full rounded-xl" />
          {layout === 'split' && <Skeleton className="h-24 w-full rounded-xl" />}
        </div>
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  if (query.isError) {
    return (
      <QueryError
        error={query.error}
        onRetry={() => void query.refetch()}
        retryLabel={t('retry')}
      />
    )
  }

  const View = layout === 'split' ? SplitDiff : InlineDiff
  return <View diff={query.data} from={date(from)} to={date(to)} today={today} />
}
