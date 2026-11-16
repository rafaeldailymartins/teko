'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { useTranslations } from 'next-intl'
import type { GetProvisionTimelineResponse } from '@/lib/api/__generated__/types.gen'
import { cn } from '@/lib/utils'
import { todayIsoDate, ValidityStatus, validityStatus } from '@/lib/validity'
import { ValidityBadge } from './validity-badge.tsx'

type Version = GetProvisionTimelineResponse['versions'][number]

interface ProvisionTimelineProps {
  /** Redações em ordem cronológica de vigência (`GET /provisions/:stableKey/timeline`). */
  readonly versions: readonly Version[]
  /** Redação mostrada ao lado (marcada com `aria-current`); `-1` = nenhuma. */
  readonly selectedIndex: number
  /** Escolher uma redação; sem ele, a linha do tempo só lista. */
  readonly onSelect?: (index: number) => void
  /** Hoje (America/Sao_Paulo), para o estado de cada badge; os testes fixam. */
  readonly today?: IsoDate
  /** Rótulo da data de referência ao lado da redação marcada ("Em 01/05/2008"). */
  readonly selectedLabel?: string
}

/** Marcador de cada redação no fio: a escolhida é o ponto âmbar da data; a vigente hoje, a folha. */
function Marker({ selected, current }: { readonly selected: boolean; readonly current: boolean }) {
  if (selected) {
    return (
      <span
        aria-hidden="true"
        className="absolute top-2.5 -left-[1.4375rem] flex size-3.5 items-center justify-center rounded-full bg-date-mark shadow-[0_0_0_3px_var(--background),0_0_0_4px_color-mix(in_oklch,var(--date-mark)_45%,transparent)]"
      >
        <span className="size-1 rounded-full bg-background" />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'absolute top-3 -left-[1.3125rem] size-2.5 rounded-full shadow-[0_0_0_3px_var(--background)]',
        current ? 'bg-leaf' : 'border-2 border-border-strong bg-background',
      )}
    />
  )
}

/**
 * Linha do tempo vertical de um dispositivo, no motivo da logo: um fio do verde-folha ao petróleo,
 * um marcador por redação (cheio quando vigente hoje) e o ponto âmbar na redação mostrada, a da
 * data de referência. Cada redação traz o badge de vigência, o rótulo da época e o ato que a
 * trouxe. Reutilizável (página de dispositivo e painel de citação do chat): o estado da escolha
 * fica com quem a usa.
 */
export function ProvisionTimeline({
  versions,
  selectedIndex,
  onSelect,
  today = todayIsoDate(),
  selectedLabel,
}: ProvisionTimelineProps) {
  const t = useTranslations('provision.timeline')
  return (
    <ol
      aria-label={t('label')}
      className="relative flex flex-col gap-1 pl-6 before:absolute before:top-3 before:bottom-3 before:left-[0.6875rem] before:w-px before:bg-linear-to-b before:from-leaf/70 before:to-primary/50"
    >
      {versions.map((version, index) => {
        const selected = index === selectedIndex
        const current = validityStatus(version.validity, today) === ValidityStatus.Current
        const key = `${version.validity.from ?? ''}|${version.validity.to ?? ''}`
        const content = (
          <>
            <span className="flex flex-wrap items-center gap-2">
              <ValidityBadge interval={version.validity} today={today} />
              {selected && selectedLabel !== undefined && (
                <span className="font-medium font-mono text-accent-foreground text-xs tabular-nums">
                  {selectedLabel}
                </span>
              )}
            </span>
            <span lang="pt-BR" className="font-medium text-sm">
              {version.label}
            </span>
            {version.act !== null && (
              <span lang="pt-BR" className="text-muted-foreground text-xs leading-snug">
                {version.act}
              </span>
            )}
          </>
        )
        return (
          <li key={key} className="relative">
            <Marker selected={selected} current={current} />
            {onSelect === undefined ? (
              <div
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg px-2.5 py-2',
                  selected && 'bg-accent/45 ring-1 ring-accent-border/40',
                )}
              >
                {content}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 ease-out-soft hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'bg-accent/45 ring-1 ring-accent-border/40 hover:bg-accent/60',
                )}
              >
                {content}
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}
