'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { useTranslations } from 'next-intl'
import type { GetProvisionTimelineResponse } from '@/lib/api/__generated__/types.gen'
import { cn } from '@/lib/utils'
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
}

/**
 * Linha do tempo de um dispositivo: cada redação com o badge de vigência, o rótulo da época e o
 * ato que a trouxe. Reutilizável (página de dispositivo e painel de citação do chat): o estado da
 * escolha fica com quem a usa.
 */
export function ProvisionTimeline({
  versions,
  selectedIndex,
  onSelect,
  today,
}: ProvisionTimelineProps) {
  const t = useTranslations('provision.timeline')
  return (
    <ol aria-label={t('label')} className="relative flex flex-col gap-2 border-l pl-4">
      {versions.map((version, index) => {
        const selected = index === selectedIndex
        const key = `${version.validity.from ?? ''}|${version.validity.to ?? ''}`
        const content = (
          <>
            <ValidityBadge
              interval={version.validity}
              {...(today === undefined ? {} : { today })}
            />
            <span lang="pt-BR" className="font-medium text-sm">
              {version.label}
            </span>
            {version.act !== null && (
              <span className="text-muted-foreground text-xs">{version.act}</span>
            )}
          </>
        )
        return (
          <li key={key} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                '-left-[1.3rem] absolute top-2.5 size-2.5 rounded-full border-2 border-background',
                selected ? 'bg-primary' : 'bg-border-strong',
              )}
            />
            {onSelect === undefined ? (
              <div className="flex flex-col items-start gap-1 py-1">{content}</div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(index)}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col items-start gap-1 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                  selected && 'bg-muted',
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
