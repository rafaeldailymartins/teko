'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { ChevronRightIcon, CircleAlertIcon, SearchIcon, SearchXIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useDeferredValue, useId, useState } from 'react'
import { SupportId } from '@/components/support-id'
import { Skeleton } from '@/components/ui/skeleton'
import { useProvisionSearch } from '@/lib/api/hooks'
import { formatIsoDate } from '@/lib/i18n/format'
import { provisionHref } from '@/lib/url-state'
import { ValidityBadge } from './validity-badge.tsx'

/** Mínimo de caracteres para buscar (o mesmo da API). */
const MIN_QUERY_LENGTH = 2

/** Buscas de exemplo, uma por família do corpus (preenchem o campo). */
const EXAMPLES = ['art. 76', 'C170', 'R-4020', 'Tabela 5.2'] as const

interface ProvisionSearchProps {
  /** Data em que os dispositivos devem estar vigentes. */
  readonly at: IsoDate
  /** Campo da data de referência, ao lado da busca. */
  readonly dateField?: ReactNode
}

/**
 * Busca de dispositivos vigentes numa data (`GET /provisions?q=&at=`), por rótulo ("art. 76"),
 * chave ("C170") ou trecho do texto. O texto digitado vai para a consulta com `useDeferredValue`:
 * a digitação não espera a rede. Antes de digitar, exemplos de busca; os resultados vêm em
 * cartões com o badge de vigência e o começo do texto.
 */
export function ProvisionSearch({ at, dateField }: ProvisionSearchProps) {
  const t = useTranslations('provision.search')
  const tRoot = useTranslations()
  const locale = useLocale()
  const inputId = useId()
  const hintId = useId()
  const [text, setText] = useState('')
  const deferred = useDeferredValue(text)
  const query = useProvisionSearch(deferred, { referenceDate: at })
  const ready = deferred.trim().length >= MIN_QUERY_LENGTH

  return (
    <search className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-popover p-4 shadow-raised sm:flex-row sm:items-end sm:p-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={inputId} className="font-medium text-muted-foreground text-xs">
            {t('label')}
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-4 text-muted-foreground"
            />
            <input
              id={inputId}
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t('placeholder')}
              aria-describedby={hintId}
              autoComplete="off"
              maxLength={120}
              className="h-10 w-full rounded-full border border-input/70 bg-background pr-4 pl-10 text-[15px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>
        </div>
        {dateField}
      </div>
      <p id={hintId} className="-mt-2 px-1 text-muted-foreground text-xs">
        {t('hint', { date: formatIsoDate(locale, at, 'numeric') })}
      </p>

      {!ready && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-muted-foreground text-xs">{t('examples')}</span>
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              className="inline-flex h-7 items-center rounded-full border bg-surface px-3 font-mono text-xs outline-none transition-colors duration-150 hover:border-border-strong/50 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite">
        {ready && query.isPending && (
          <div role="status" className="flex flex-col gap-2.5">
            <span className="sr-only">{t('searching')}</span>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        )}
        {ready && query.isError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border bg-popover p-4 text-muted-foreground text-sm"
          >
            <CircleAlertIcon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            {tRoot(query.error.messageKey)}
          </p>
        )}
        {ready && query.isError && <SupportId traceId={query.error.traceId} />}
        {ready && query.isSuccess && query.data.items.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-surface px-6 py-10 text-center">
            <SearchXIcon aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">{t('empty')}</p>
          </div>
        )}
        {ready && query.isSuccess && query.data.items.length > 0 && (
          <ul className="flex flex-col gap-2.5" aria-label={t('results')}>
            {query.data.items.map((item) => (
              <li key={item.stableKey}>
                <Link
                  href={provisionHref(locale, item.stableKey, { referenceDate: at }) as Route}
                  className="group/result relative flex flex-col gap-1.5 rounded-xl border bg-popover py-3.5 pr-10 pl-4 shadow-soft outline-none transition-[border-color,box-shadow] duration-150 ease-out-soft hover:border-border-strong/50 hover:shadow-raised focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span lang="pt-BR" className="font-semibold font-serif text-base">
                      {item.label}
                    </span>
                    <ValidityBadge interval={item.validity} />
                  </span>
                  <span lang="pt-BR" className="line-clamp-2 text-muted-foreground text-sm">
                    {item.excerpt}
                  </span>
                  <span className="font-mono text-[0.6875rem] text-muted-foreground">
                    {item.stableKey}
                  </span>
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="-translate-y-1/2 absolute top-1/2 right-3.5 size-4 text-muted-foreground transition-transform duration-150 group-hover/result:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </search>
  )
}
