'use client'

import { ErrorCode } from '@teko/shared/errors'
import { type IsoDate, isoDateSchema } from '@teko/shared/vigencia'
import { GitCompareArrowsIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useQueryStates } from 'nuqs'
import { Suspense, useId, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useProvisionTimeline } from '@/lib/api/hooks'
import { referenceKeyDate } from '@/lib/api/reference'
import { formatIsoDate } from '@/lib/i18n/format'
import { localePagePath } from '@/lib/navigation'
import { compareHref, provisionSearchParams } from '@/lib/url-state'
import { dateWithin, displayedVersionIndex, todayIsoDate, versionIndexAt } from '@/lib/validity'
import { ProvisionDiff } from './provision-diff.tsx'
import { ProvisionSearch } from './provision-search.tsx'
import { ProvisionText } from './provision-text.tsx'
import { ProvisionTimeline } from './provision-timeline.tsx'
import { ValidityBadge } from './validity-badge.tsx'

function ProvisionLoading() {
  const t = useTranslations('provision')
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">{t('loading')}</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-28 w-full" />
    </div>
  )
}

/** Campo de data que troca a referência da página (`?ref=`). */
function ReferenceDateField({
  value,
  onChange,
}: {
  readonly value: IsoDate
  readonly onChange: (date: IsoDate) => void
}) {
  const t = useTranslations('provision')
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium text-muted-foreground text-xs">
        {t('dateLabel')}
      </label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => {
          const parsed = isoDateSchema.safeParse(event.target.value)
          if (parsed.success) {
            onChange(parsed.data)
          }
        }}
        className="w-auto font-mono tabular-nums"
      />
    </div>
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
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p className="text-muted-foreground">{tRoot(query.error.messageKey)}</p>
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
    )
  }

  const { versions } = query.data
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
      <header className="flex flex-col gap-3">
        <p className="font-mono text-muted-foreground text-xs">{stableKey}</p>
        <h1 lang="pt-BR" className="font-semibold font-serif text-3xl tracking-tight">
          {version.label}
        </h1>
        <div className="flex flex-wrap items-end gap-4">
          <ReferenceDateField value={date} onChange={onDateChange} />
          <ValidityBadge interval={version.validity} today={today} />
        </div>
        <p className="text-muted-foreground text-sm">
          {exact ? t('shownAt', { date: formatted }) : t('absentAt', { date: formatted })}
        </p>
      </header>

      <section aria-labelledby={`${diffId}-text`} className="flex flex-col gap-3">
        <h2 id={`${diffId}-text`} className="sr-only">
          {t('text')}
        </h2>
        <ProvisionText version={version} />
      </section>

      <section aria-labelledby={`${diffId}-changes`} className="flex flex-col gap-3">
        <h2 id={`${diffId}-changes`} className="font-semibold font-serif text-xl">
          {t('whatChanged')}
        </h2>
        {previous === undefined || diffFrom === null ? (
          <p className="text-muted-foreground text-sm">{t('firstVersion')}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
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
                <ProvisionDiff stableKey={stableKey} from={diffFrom} to={diffTo} today={today} />
              )}
            </div>
          </>
        )}
      </section>

      <section aria-labelledby={`${diffId}-timeline`} className="flex flex-col gap-3">
        <h2 id={`${diffId}-timeline`} className="font-semibold font-serif text-xl">
          {t('timeline.title')}
        </h2>
        <p className="text-muted-foreground text-sm">
          {t('timeline.count', { count: versions.length })}
        </p>
        <ProvisionTimeline
          versions={versions}
          selectedIndex={index}
          today={today}
          onSelect={(selected) => {
            const target = versions[selected]
            if (target !== undefined) {
              setDiffOpen(false)
              onDateChange(dateWithin(target.validity, today))
            }
          }}
        />
      </section>
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
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="font-semibold font-serif text-3xl tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('intro')}</p>
        </header>
        <ReferenceDateField value={date} onChange={setDate} />
        <ProvisionSearch at={date} />
      </div>
    )
  }
  return <ProvisionDetail stableKey={k} date={date} today={today} onDateChange={setDate} />
}

/**
 * Página de dispositivo (`/provision/?k=<stableKey>&ref=<data>`): a redação vigente na data, com o
 * badge de vigência, o texto em `lang="pt-BR"`, "O que mudou" (diff carregado sob demanda) e a
 * linha do tempo. Sem `k`, a busca de dispositivos.
 */
export function ProvisionView() {
  return (
    <Suspense fallback={<ProvisionLoading />}>
      <ProvisionViewContent />
    </Suspense>
  )
}
