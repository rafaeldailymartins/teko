'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { GitCompareArrowsIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { lazy, type ReactNode, Suspense, useId, useState } from 'react'
import { ProvisionTimeline } from '@/components/provision/provision-timeline'
import { QueryError } from '@/components/query-error'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProvisionTimeline } from '@/lib/api/hooks'
import { formatIsoDate } from '@/lib/i18n/format'
import { dateWithin, displayedVersionIndex, versionIndexAt } from '@/lib/validity'

/** "O que mudou" só baixa o próprio código no clique (fora do chunk do painel). */
const ProvisionDiff = lazy(() =>
  import('@/components/provision/provision-diff').then((module) => ({
    default: module.ProvisionDiff,
  })),
)

function DiffSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}

interface CitationTimelineProps {
  readonly stableKey: string
  /** Data de referência da resposta (`data-reference-date`); sem ela, hoje. */
  readonly referenceDate: IsoDate | null
  readonly today: IsoDate
}

/**
 * Linha do tempo e "O que mudou" do dispositivo citado, no painel de citação: os mesmos
 * componentes da página de dispositivo (`ProvisionTimeline`, `ProvisionDiff`). A linha do tempo
 * marca a redação vigente na data de referência da resposta; o diff compara essa redação com a
 * anterior e só é pedido à API no clique.
 */
export function CitationTimeline({ stableKey, referenceDate, today }: CitationTimelineProps) {
  const t = useTranslations('provision')
  const locale = useLocale()
  const query = useProvisionTimeline(stableKey)
  const [diffOpen, setDiffOpen] = useState(false)
  const id = useId()
  const date = referenceDate ?? today

  let body: ReactNode
  if (query.isPending) {
    body = (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  } else if (query.isError) {
    body = (
      <QueryError
        error={query.error}
        onRetry={() => void query.refetch()}
        retryLabel={t('retry')}
      />
    )
  } else {
    const { versions } = query.data
    const index = displayedVersionIndex(versions, date)
    const version = versions[index]
    const previous = versions[index - 1]
    // A redação vigente na data (a própria data) ou, sem nenhuma, a mais próxima anterior.
    let diffTo: IsoDate | null = null
    if (version !== undefined) {
      diffTo = versionIndexAt(versions, date) === index ? date : dateWithin(version.validity, date)
    }
    const diffFrom = previous === undefined ? null : dateWithin(previous.validity, date)
    body = (
      <>
        <ProvisionTimeline
          versions={versions}
          selectedIndex={index}
          today={today}
          selectedLabel={t('timeline.atReference', {
            date: formatIsoDate(locale, date, 'numeric'),
          })}
        />
        <section aria-labelledby={`${id}-changes`} className="flex flex-col gap-2.5 pt-2">
          <h4 id={`${id}-changes`} className="font-semibold font-serif text-base">
            {t('whatChanged')}
          </h4>
          {diffFrom === null || diffTo === null ? (
            <p className="text-muted-foreground text-sm">{t('firstVersion')}</p>
          ) : (
            <>
              <Button
                variant={diffOpen ? 'secondary' : 'outline'}
                size="sm"
                className="self-start"
                aria-expanded={diffOpen}
                aria-controls={`${id}-diff`}
                onClick={() => setDiffOpen((open) => !open)}
              >
                <GitCompareArrowsIcon aria-hidden="true" />
                {diffOpen ? t('hideDiff') : t('showDiff')}
              </Button>
              <div id={`${id}-diff`}>
                {diffOpen && (
                  <Suspense fallback={<DiffSkeleton />}>
                    <ProvisionDiff
                      stableKey={stableKey}
                      from={diffFrom}
                      to={diffTo}
                      today={today}
                    />
                  </Suspense>
                )}
              </div>
            </>
          )}
        </section>
      </>
    )
  }

  return (
    <section aria-labelledby={`${id}-timeline`} className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h4 id={`${id}-timeline`} className="font-semibold font-serif text-base">
          {t('timeline.title')}
        </h4>
        {query.isSuccess && (
          <span className="text-muted-foreground text-xs">
            {t('timeline.count', { count: query.data.versions.length })}
          </span>
        )}
      </div>
      {body}
    </section>
  )
}
