'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { ValidityBadge } from './validity-badge.tsx'

interface SourceListProps {
  readonly citations: readonly Citation[]
  readonly today: IsoDate
  readonly selectedCitationId: string | null
  readonly onOpen: (id: string) => void
}

/** Fontes à vista antes de "Mostrar as outras". */
const VISIBLE_SOURCES = 4

/**
 * Fontes da resposta em cartões: número, dispositivo, documento e a situação da redação hoje. O
 * cartão inteiro abre o painel de citação (o botão se estende sobre ele); a citação aberta fica
 * marcada, e a recusada pelo validador sai riscada. Com muitas fontes, as primeiras ficam à vista e
 * o resto abre num botão (a aberta no painel nunca fica escondida).
 */
export function SourceList({ citations, today, selectedCitationId, onOpen }: SourceListProps) {
  const t = useTranslations('chat')
  const titleId = useId()
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const selectedIndex = citations.findIndex((citation) => citation.id === selectedCitationId)
  const showAll =
    expanded || citations.length <= VISIBLE_SOURCES || selectedIndex >= VISIBLE_SOURCES
  const visible = showAll ? citations : citations.slice(0, VISIBLE_SOURCES)
  return (
    <section aria-labelledby={titleId} className="@container flex max-w-[70ch] flex-col gap-2 pt-1">
      <h2
        id={titleId}
        className="font-semibold text-muted-foreground text-xs uppercase tracking-wider"
      >
        {t('answer.citations')}
      </h2>
      <ul id={listId} className="grid gap-2 @lg:grid-cols-2">
        {visible.map((citation) => {
          const selected = selectedCitationId === citation.id
          return (
            <li
              key={citation.id}
              className={cn(
                'relative flex min-w-0 flex-col gap-1 rounded-lg border bg-popover px-3 py-2.5 shadow-soft transition-[border-color,box-shadow] duration-150 ease-out-soft hover:border-border-strong/50 hover:shadow-raised has-focus-visible:ring-2 has-focus-visible:ring-ring',
                selected && 'border-primary/60 ring-1 ring-primary/40',
              )}
            >
              <button
                type="button"
                data-source-id={citation.id}
                aria-pressed={selected}
                onClick={() => onOpen(citation.id)}
                className="flex min-w-0 items-start gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-lg"
              >
                {/* Nome acessível "Fonte n: dispositivo", como o do chip (filhos flex viram blocos). */}
                <span className="sr-only">
                  {t('citation.sourcePrefix')} {citation.id.slice(1)}:
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-px flex size-5 shrink-0 items-center justify-center rounded-full font-medium font-mono text-[0.6875rem] tabular-nums',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                  )}
                >
                  {citation.id.slice(1)}
                </span>
                <span
                  lang="pt-BR"
                  className={cn(
                    'min-w-0 font-medium text-sm leading-snug',
                    !citation.valid && 'line-through',
                  )}
                >
                  {citation.label}
                </span>
              </button>
              <span lang="pt-BR" className="truncate pl-7 text-muted-foreground text-xs">
                {citation.document.title}
              </span>
              <ValidityBadge
                interval={citation.validity}
                today={today}
                variant="inline"
                className="pl-7 font-normal"
              />
            </li>
          )
        })}
      </ul>
      {citations.length > VISIBLE_SOURCES && selectedIndex < VISIBLE_SOURCES && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex items-center gap-1.5 self-start rounded-md px-1 py-0.5 font-medium text-primary text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn('size-4 transition-transform duration-150', expanded && 'rotate-180')}
          />
          {expanded
            ? t('answer.sourcesLess')
            : t('answer.sourcesMore', { count: citations.length - VISIBLE_SOURCES })}
        </button>
      )}
    </section>
  )
}
