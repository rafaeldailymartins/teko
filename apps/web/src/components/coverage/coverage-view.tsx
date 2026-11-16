'use client'

import type { FamilyCoverage } from '@teko/shared/contracts'
import { lastIncludedDay, type ValidityInterval } from '@teko/shared/vigencia'
import { LibraryIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId } from 'react'
import { EmptyState } from '@/components/empty-state'
import { QueryError } from '@/components/query-error'
import { Skeleton } from '@/components/ui/skeleton'
import { useCoverage } from '@/lib/api/hooks'
import {
  type CoverageScale,
  coverageGaps,
  coverageScale,
  coverageSegments,
  familyMessageKey,
  groupByJurisdiction,
  lastVerification,
  SegmentKind,
} from '@/lib/coverage'
import { formatIsoDate, formatValidityBounds } from '@/lib/i18n/format'
import { cn } from '@/lib/utils'

const SEGMENT_CLASSES: Readonly<Record<SegmentKind, string>> = {
  [SegmentKind.Covered]: 'bg-validity-current',
  [SegmentKind.Gap]: 'bg-coverage-out',
}

/** Texto de um período `[from, to)` com o último dia incluído ("01/01/1998 a 10/11/2026"). */
function useRangeText(): (interval: ValidityInterval) => string {
  const t = useTranslations('coverage')
  const locale = useLocale()
  return (interval) => {
    const { from, to } = formatValidityBounds(locale, interval)
    if (from !== null && to !== null) return t('range', { from, to })
    if (from !== null) return t('since', { from })
    if (to !== null) return t('until', { to })
    return t('always')
  }
}

function CoverageLoading() {
  const t = useTranslations('coverage')
  return (
    <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  )
}

/** Barra proporcional da cobertura na escala comum (decorativa: as listas dizem o mesmo). */
function CoverageBar({
  covered,
  scale,
}: {
  readonly covered: readonly ValidityInterval[]
  readonly scale: CoverageScale
}) {
  return (
    <div aria-hidden="true" className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
      {coverageSegments(covered, scale).map((segment) => (
        <span
          key={`${segment.kind}-${segment.start}`}
          data-segment={segment.kind}
          className={cn('absolute inset-y-0', SEGMENT_CLASSES[segment.kind])}
          style={{ left: `${segment.start}%`, width: `${segment.width}%` }}
        />
      ))}
    </div>
  )
}

function FamilyCard({
  family,
  scale,
}: {
  readonly family: FamilyCoverage
  readonly scale: CoverageScale | null
}) {
  const t = useTranslations('coverage')
  const locale = useLocale()
  const rangeText = useRangeText()
  const titleId = useId()
  const key = familyMessageKey(family.family)
  const gaps = coverageGaps(family.covered)

  return (
    <li>
      <article
        aria-labelledby={titleId}
        data-family={family.family}
        className="flex flex-col gap-4 rounded-xl border bg-surface p-5"
      >
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 id={titleId} className="font-semibold font-serif text-lg tracking-tight">
            {key === null ? family.family : t(`families.${key}.name`)}
          </h3>
          <span className="font-mono text-muted-foreground text-xs">{family.family}</span>
        </header>
        {key !== null && (
          <p className="text-muted-foreground text-sm">
            <span className="sr-only">{t('sources')}: </span>
            {t(`families.${key}.sources`)}
          </p>
        )}
        {scale !== null && family.covered.length > 0 && (
          <CoverageBar covered={family.covered} scale={scale} />
        )}
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-muted-foreground text-xs">{t('covered')}</dt>
            {family.covered.length === 0 ? (
              <dd className="text-coverage-out">{t('noCoverage')}</dd>
            ) : (
              family.covered.map((interval) => (
                <dd
                  key={`${interval.from ?? ''}|${interval.to ?? ''}`}
                  className="font-mono tabular-nums"
                >
                  {rangeText(interval)}
                </dd>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-muted-foreground text-xs">{t('gaps')}</dt>
            {gaps.length === 0 ? (
              <dd>{t('noGaps')}</dd>
            ) : (
              gaps.map((gap) => (
                <dd
                  key={`${gap.from ?? ''}|${gap.to ?? ''}`}
                  data-gap
                  className="font-mono text-coverage-out tabular-nums"
                >
                  {rangeText(gap)}
                </dd>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-muted-foreground text-xs">{t('verifiedAt')}</dt>
            <dd className="font-mono tabular-nums">
              <time dateTime={family.verifiedAt}>
                {formatIsoDate(locale, family.verifiedAt, 'numeric')}
              </time>
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="font-medium text-muted-foreground text-xs">{t('jurisdictionLabel')}</dt>
            <dd>{t(`jurisdiction.${family.jurisdiction}`)}</dd>
          </div>
        </dl>
      </article>
    </li>
  )
}

/** Legenda das barras e a escala comum (do começo mais antigo ao dia da última verificação). */
function CoverageLegend({ scale }: { readonly scale: CoverageScale }) {
  const t = useTranslations('coverage')
  const locale = useLocale()
  const last = lastIncludedDay(scale)
  return (
    // Legenda visual das barras (que são `aria-hidden`): o leitor de tela lê só o texto dela, e os
    // períodos e lacunas de cada família já vêm por extenso no cartão.
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground text-xs">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-validity-current" />
        {t('legendCovered')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-coverage-out" />
        {t('legendGap')}
      </span>
      {last !== null && (
        <span className="font-mono tabular-nums">
          {t('scale', {
            from: formatIsoDate(locale, scale.from, 'numeric'),
            to: formatIsoDate(locale, last, 'numeric'),
          })}
        </span>
      )}
    </div>
  )
}

/**
 * Cobertura do corpus (`GET /api/v1/coverage`, pública): por jurisdição e família, as fontes, os
 * períodos cobertos, as lacunas e a última verificação, com uma barra proporcional numa escala
 * comum. Carregamento, erro (com "tentar de novo" quando o erro é transitório) e vazio.
 */
export function CoverageView() {
  const t = useTranslations('coverage')
  const locale = useLocale()
  const query = useCoverage()

  if (query.isPending) {
    return <CoverageLoading />
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

  const { families, corpusVersion } = query.data
  if (families.length === 0) {
    return (
      <EmptyState
        icon={<LibraryIcon />}
        title={t('emptyTitle')}
        className="rounded-xl border border-dashed bg-surface"
      >
        {t('emptyBody')}
      </EmptyState>
    )
  }

  const latest = lastVerification(families)
  const scale = coverageScale(families)
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1 text-sm">
        {latest !== null && (
          <p>
            {t('lastVerified', { date: formatIsoDate(locale, latest, 'numeric') })}{' '}
            <span className="text-muted-foreground">
              {t('corpusVersion', { version: corpusVersion })}
            </span>
          </p>
        )}
        <p className="text-muted-foreground">{t('afterVerification')}</p>
      </div>
      {scale !== null && <CoverageLegend scale={scale} />}
      {groupByJurisdiction(families).map((group) => (
        <section
          key={group.jurisdiction}
          aria-labelledby={`coverage-${group.jurisdiction}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`coverage-${group.jurisdiction}`}
            className="font-semibold font-serif text-xl tracking-tight"
          >
            {t(`jurisdiction.${group.jurisdiction}`)}
          </h2>
          <ul className="flex flex-col gap-3">
            {group.families.map((family) => (
              <FamilyCard key={family.family} family={family} scale={scale} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
