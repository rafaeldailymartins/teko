'use client'

import { ErrorCode } from '@teko/shared/errors'
import type { IsoDate } from '@teko/shared/vigencia'
import { ChevronLeftIcon, CircleAlertIcon, GitCompareArrowsIcon, InfoIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { Suspense, useId, useState } from 'react'
import { AppPageHeader } from '@/components/app-page-header'
import { SupportId } from '@/components/support-id'
import { Button, buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProvisionTimeline } from '@/lib/api/hooks'
import { referenceKeyDate } from '@/lib/api/reference'
import { formatIsoDate } from '@/lib/i18n/format'
import { localePagePath } from '@/lib/navigation'
import { compareHref, provisionSearchParams } from '@/lib/url-state'
import { cn } from '@/lib/utils'
import { dateWithin, displayedVersionIndex, todayIsoDate, versionIndexAt } from '@/lib/validity'
import { ProvisionDiff } from './provision-diff.tsx'
import { ProvisionSearch } from './provision-search.tsx'
import { ProvisionText } from './provision-text.tsx'
import { ProvisionTimeline } from './provision-timeline.tsx'
import { ReferenceDateField } from './reference-date-field.tsx'
import { ValidityBadge } from './validity-badge.tsx'

/** Carregamento com a forma da página: cabeçalho, texto e linha do tempo ao lado. */
function ProvisionLoading() {
  const t = useTranslations('provision')
  return (
    <div role="status" className="flex flex-col gap-8">
      <span className="sr-only">{t('loading')}</span>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-9 w-72 rounded-lg" />
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** Voltar à busca de dispositivos na mesma data. */
function BackToSearch({ date }: { readonly date: IsoDate }) {
  const t = useTranslations('provision')
  const locale = useLocale()
  return (
    <Link
      href={`${localePagePath(locale, 'provision')}?ref=${date}` as Route}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2.5 self-start')}
    >
      <ChevronLeftIcon aria-hidden="true" />
      {t('backToSearch')}
    </Link>
  )
}

interface ProvisionDetailProps {
  readonly stableKey: string
  readonly date: IsoDate
  readonly today: IsoDate
  readonly onDateChange: (date: IsoDate) => void
}

function ProvisionDetail({ stableKey, date, today, onDateChange }: ProvisionDetailProps) {
  const t = useTranslations('provision')
  const tRoot = useTranslations()
  const locale = useLocale()
  const query = useProvisionTimeline(stableKey)
  const [diffOpen, setDiffOpen] = useState(false)
  const diffId = useId()

  if (query.isPending) {
    return <ProvisionLoading />
  }
  if (query.isError) {
    const notFound = query.error.code === ErrorCode.NotFound
    return (
      <div className="flex flex-col gap-6">
        <BackToSearch date={date} />
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-2xl border bg-popover p-6 text-sm shadow-soft"
        >
          <p className="flex items-start gap-2 text-muted-foreground">
            <CircleAlertIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            {tRoot(query.error.messageKey)}
          </p>
          <SupportId traceId={query.error.traceId} />
          {notFound ? (
            <Link
              href={localePagePath(locale, 'provision')}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {t('backToSearch')}
            </Link>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              {t('retry')}
            </Button>
          )}
        </div>
      </div>
    )
  }

  const { versions, family, jurisdiction } = query.data
  const index = displayedVersionIndex(versions, date)
  const version = versions[index]
  if (version === undefined) {
    return <p className="text-muted-foreground text-sm">{tRoot('errors.not_found')}</p>
  }
  const exact = versionIndexAt(versions, date) === index
  const previous = versions[index - 1]
  const formatted = formatIsoDate(locale, date, 'numeric')
  const diffFrom = previous === undefined ? null : dateWithin(previous.validity, date)
  const diffTo = dateWithin(version.validity, date)

  return (
    <div className="flex flex-col gap-8">
      <BackToSearch date={date} />
      <AppPageHeader
        className="-mt-4"
        eyebrow={
          <span className="font-mono normal-case tracking-normal">
            {family} · {jurisdiction} · {stableKey}
          </span>
        }
        title={version.label}
        titleLang="pt-BR"
        description={
          <span className="flex flex-col items-start gap-2.5">
            <ValidityBadge interval={version.validity} today={today} />
            <span className={cn('inline-flex items-start gap-1.5', !exact && 'text-degraded')}>
              {!exact && <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
              {exact ? t('shownAt', { date: formatted }) : t('absentAt', { date: formatted })}
            </span>
          </span>
        }
        actions={<ReferenceDateField label={t('dateLabel')} value={date} onChange={onDateChange} />}
      />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-10">
          <section aria-labelledby={`${diffId}-text`} className="flex flex-col gap-3">
            <h2 id={`${diffId}-text`} className="sr-only">
              {t('text')}
            </h2>
            <ProvisionText version={version} />
          </section>

          <section aria-labelledby={`${diffId}-changes`} className="flex flex-col gap-4">
            <h2
              id={`${diffId}-changes`}
              className="font-semibold font-serif text-2xl tracking-tight"
            >
              {t('whatChanged')}
            </h2>
            {previous === undefined || diffFrom === null ? (
              <p className="text-muted-foreground text-sm">{t('firstVersion')}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={diffOpen ? 'secondary' : 'outline'}
                    aria-expanded={diffOpen}
                    aria-controls={diffId}
                    onClick={() => setDiffOpen((open) => !open)}
                  >
                    {diffOpen ? t('hideDiff') : t('showDiff')}
                  </Button>
                  <Link
                    href={
                      compareHref(
                        locale,
                        stableKey,
                        { referenceDate: diffFrom },
                        { referenceDate: diffTo },
                      ) as Route
                    }
                    className={buttonVariants({ variant: 'ghost' })}
                  >
                    <GitCompareArrowsIcon aria-hidden="true" />
                    {t('compareLink')}
                  </Link>
                </div>
                <div id={diffId}>
                  {diffOpen && (
                    <ProvisionDiff
                      stableKey={stableKey}
                      from={diffFrom}
                      to={diffTo}
                      today={today}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        <aside aria-labelledby={`${diffId}-timeline`} className="lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2
                id={`${diffId}-timeline`}
                className="font-semibold font-serif text-xl tracking-tight"
              >
                {t('timeline.title')}
              </h2>
              <span className="text-muted-foreground text-xs">
                {t('timeline.count', { count: versions.length })}
              </span>
            </div>
            <ProvisionTimeline
              versions={versions}
              selectedIndex={index}
              today={today}
              selectedLabel={t('timeline.atReference', { date: formatted })}
              onSelect={(selected) => {
                const target = versions[selected]
                if (target !== undefined) {
                  setDiffOpen(false)
                  onDateChange(dateWithin(target.validity, today))
                }
              }}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

function ProvisionViewContent() {
  const t = useTranslations('provision')
  const [{ k, ref }, setState] = useQueryStates(provisionSearchParams)
  const today = todayIsoDate()
  const date = ref === null ? today : referenceKeyDate(ref)
  const setDate = (next: IsoDate) => void setState({ ref: { referenceDate: next } })

  if (k === null) {
    return (
      <div className="flex flex-col gap-8">
        <AppPageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('intro')} />
        <ProvisionSearch
          at={date}
          dateField={<ReferenceDateField label={t('dateLabel')} value={date} onChange={setDate} />}
        />
      </div>
    )
  }
  return <ProvisionDetail stableKey={k} date={date} today={today} onDateChange={setDate} />
}

/**
 * Página de dispositivo (`/provision/?k=<stableKey>&ref=<data>`): a redação vigente na data, com o
 * badge de vigência, o texto em `lang="pt-BR"` num cartão de leitura, "O que mudou" (diff carregado
 * sob demanda) e, ao lado no desktop, a linha do tempo. Sem `k`, a busca de dispositivos.
 */
export function ProvisionView() {
  return (
    <Suspense fallback={<ProvisionLoading />}>
      <ProvisionViewContent />
    </Suspense>
  )
}
