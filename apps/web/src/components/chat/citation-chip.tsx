'use client'

import type { Citation } from '@teko/shared/contracts'
import type { IsoDate } from '@teko/shared/vigencia'
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
  'mx-0.5 inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full border px-1.5 align-baseline font-medium font-mono text-xs tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * Chip numerado de uma citação: abre o painel de citação no clique e mostra uma prévia (dispositivo,
 * documento e vigência) no hover e no foco. Citação recusada pelo validador sai riscada.
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
        delay={300}
        render={<button type="button" />}
        onClick={onOpen}
        aria-label={t('chip', { number, label: citation.label })}
        aria-pressed={selected ?? false}
        data-citation-id={citation.id}
        className={cn(
          CHIP_CLASSES,
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border-strong bg-surface text-foreground hover:bg-muted',
          !citation.valid && 'line-through',
        )}
      >
        {number}
      </HoverCardTrigger>
      <HoverCardContent className="flex flex-col gap-2">
        <p className="font-medium">{citation.label}</p>
        <p className="text-muted-foreground text-xs">
          {citation.document.title} · {citation.document.versionLabel}
        </p>
        <ValidityBadge interval={citation.validity} today={today} className="self-start" />
        {!citation.valid && <p className="text-coverage-out text-xs">{t('invalid')}</p>}
      </HoverCardContent>
    </HoverCard>
  )
}
