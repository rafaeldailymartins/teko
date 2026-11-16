'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import type { Route } from 'next'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useDeferredValue, useId, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useProvisionSearch } from '@/lib/api/hooks'
import { formatIsoDate } from '@/lib/i18n/format'
import { provisionHref } from '@/lib/url-state'
import { ValidityBadge } from './validity-badge.tsx'

/** Mínimo de caracteres para buscar (o mesmo da API). */
const MIN_QUERY_LENGTH = 2

interface ProvisionSearchProps {
  /** Data em que os dispositivos devem estar vigentes. */
  readonly at: IsoDate
}

/**
 * Busca de dispositivos vigentes numa data (`GET /provisions?q=&at=`), por rótulo ("art. 76"),
 * chave ("C170") ou trecho do texto. O texto digitado vai para a consulta com `useDeferredValue`:
 * a digitação não espera a rede.
 */
export function ProvisionSearch({ at }: ProvisionSearchProps) {
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
    <search className="flex flex-col gap-3">
      <label htmlFor={inputId} className="font-medium text-sm">
        {t('label')}
      </label>
      <Input
        id={inputId}
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('placeholder')}
        aria-describedby={hintId}
        autoComplete="off"
        maxLength={120}
      />
      <p id={hintId} className="text-muted-foreground text-xs">
        {t('hint', { date: formatIsoDate(locale, at, 'numeric') })}
      </p>
      <div aria-live="polite">
        {ready && query.isPending && (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">{t('searching')}</span>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {ready && query.isError && (
          <p role="alert" className="text-muted-foreground text-sm">
            {tRoot(query.error.messageKey)}
          </p>
        )}
        {ready && query.isSuccess && query.data.items.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        )}
        {ready && query.isSuccess && query.data.items.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label={t('results')}>
            {query.data.items.map((item) => (
              <li key={item.stableKey}>
                <Link
                  href={provisionHref(locale, item.stableKey, { referenceDate: at }) as Route}
                  className="flex flex-col gap-1 rounded-lg border px-3 py-2 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span lang="pt-BR" className="font-medium text-sm">
                      {item.label}
                    </span>
                    <ValidityBadge interval={item.validity} />
                  </span>
                  <span lang="pt-BR" className="line-clamp-2 text-muted-foreground text-xs">
                    {item.excerpt}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </search>
  )
}
