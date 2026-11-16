'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
import { PanelRightOpenIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { cn } from '@/lib/utils'
import { ValidityBadge } from './validity-badge.tsx'

interface CitationChipProps {
  /** `null` enquanto o `data-citation` ainda não chegou no stream. */
  readonly citation: Citation | null
  /** Número exibido (o `n` de `Sn`). */
  readonly number: number
  readonly today: IsoDate
  readonly selected?: boolean
  readonly onOpen?: () => void
}

// Alvo de 24×24 px (WCAG 2.5.8) em pixels: com a raiz em 14 px (`globals.css`), `h-6` daria 21 px.
const CHIP_CLASSES =
  'mx-0.5 inline-flex h-[24px] min-w-[24px] -translate-y-px items-center justify-center rounded-full border px-1.5 align-baseline font-medium font-mono text-xs tabular-nums outline-none transition-[background-color,border-color,color,box-shadow] duration-150 ease-out-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background'

/**
 * Chip numerado de uma citação: abre o painel de citação no clique e mostra uma prévia no hover e no
 * foco (família, dispositivo em serif, documento, o começo do texto citado e a vigência). Citação
 * recusada pelo validador sai riscada.
 */
export function CitationChip({ citation, number, today, selected, onOpen }: CitationChipProps) {
  const t = useTranslations('chat.citation')
  if (citation === null) {
    return (
      <span className={cn(CHIP_CLASSES, 'border-dashed text-muted-foreground')} aria-hidden="true">
        {number}
      </span>
    )
  }
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={250}
        render={<button type="button" />}
        onClick={onOpen}
        aria-label={t('chip', { number, label: citation.label })}
        aria-pressed={selected ?? false}
        data-citation-id={citation.id}
        className={cn(
          CHIP_CLASSES,
          selected
            ? 'border-primary bg-primary text-primary-foreground shadow-soft'
            : 'border-border-strong/45 bg-muted text-foreground hover:border-primary/60 hover:bg-popover hover:shadow-soft',
          !citation.valid && 'line-through',
        )}
      >
        {number}
      </HoverCardTrigger>
      <HoverCardContent className="w-80 gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-2 px-4 pt-3.5 pb-3">
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="flex size-5 items-center justify-center rounded-full bg-muted font-medium font-mono text-[0.6875rem] text-foreground tabular-nums">
              {number}
            </span>
            <span className="font-mono uppercase tracking-wide">
              {citation.family} · {citation.jurisdiction}
            </span>
          </p>
          <p lang="pt-BR" className="font-semibold font-serif text-base leading-snug">
            {citation.label}
          </p>
          <p lang="pt-BR" className="line-clamp-2 text-muted-foreground text-xs">
            {citation.document.title} · {citation.document.versionLabel}
          </p>
          {citation.excerpt !== undefined && (
            <p
              lang="pt-BR"
              className="line-clamp-4 border-leaf/70 border-l-2 pl-3 font-serif text-[0.9375rem] leading-relaxed"
            >
              {citation.excerpt}
            </p>
          )}
          {!citation.valid && <p className="text-coverage-out text-xs">{t('invalid')}</p>}
        </div>
        <div className="flex items-center justify-between gap-2 border-t bg-surface px-4 py-2">
          <ValidityBadge interval={citation.validity} today={today} variant="inline" />
          <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
            <PanelRightOpenIcon aria-hidden="true" className="size-3.5" />
            {t('previewHint')}
          </span>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
