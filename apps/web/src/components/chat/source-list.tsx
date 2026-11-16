'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import { ChevronRightIcon } from 'lucide-react'
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

/**
 * Fontes da resposta, recolhidas numa linha ("12 fontes") que abre uma lista de uma coluna em linhas
 * finas: número, dispositivo e a situação da redação hoje. A linha inteira abre o painel de citação
 * (o botão se estende sobre ela); a citação aberta fica marcada, e a recusada pelo validador sai
 * riscada, em tom apagado.
 */
export function SourceList({ citations, today, selectedCitationId, onOpen }: SourceListProps) {
  const t = useTranslations('chat')
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  return (
    <section aria-label={t('answer.citations')} className="flex max-w-[70ch] flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((open) => !open)}
        className="-ml-1.5 inline-flex h-7 items-center gap-1 self-start rounded-md px-1.5 font-medium text-muted-foreground text-sm outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            'size-4 transition-transform duration-150 ease-out-soft',
            expanded && 'rotate-90',
          )}
        />
        {t('answer.sourcesToggle', { count: citations.length })}
      </button>
      <ol id={listId} hidden={!expanded} className="flex flex-col border-border/70 border-l pl-1">
        {citations.map((citation) => {
          const selected = selectedCitationId === citation.id
          return (
            <li
              key={citation.id}
              className={cn(
                'relative flex min-w-0 items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1 transition-colors duration-150 ease-out-soft hover:bg-muted/70 has-focus-visible:ring-2 has-focus-visible:ring-ring max-sm:flex-col max-sm:items-start',
                selected && 'bg-muted',
              )}
            >
              <button
                type="button"
                data-source-id={citation.id}
                aria-pressed={selected}
                onClick={() => onOpen(citation.id)}
                className="flex min-h-[24px] min-w-0 items-center gap-2 text-left outline-none after:absolute after:inset-0 after:rounded-md max-sm:w-full sm:flex-1"
              >
                {/* Nome acessível "Fonte n: dispositivo", como o do chip (filhos flex viram blocos). */}
                <span className="sr-only">
                  {t('citation.sourcePrefix')} {citation.id.slice(1)}:
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-5 shrink-0 text-right font-mono text-xs tabular-nums',
                    selected ? 'font-semibold text-primary' : 'text-muted-foreground',
                  )}
                >
                  {citation.id.slice(1)}
                </span>
                <span
                  lang="pt-BR"
                  title={citation.document.title}
                  className={cn(
                    'min-w-0 text-sm leading-snug',
                    citation.valid ? 'text-foreground' : 'text-muted-foreground line-through',
                  )}
                >
                  {citation.label}
                </span>
              </button>
              <ValidityBadge
                interval={citation.validity}
                today={today}
                variant="inline"
                className="shrink-0 font-normal max-sm:pl-7"
              />
            </li>
          )
        })}
      </ol>
    </section>
  )
}
