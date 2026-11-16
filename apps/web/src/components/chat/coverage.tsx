'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { AlertTriangleIcon, CircleOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCoverage } from '@/lib/api/hooks'
import { CoverageStatus, coverageAt } from '@/lib/chat/coverage'
import { cn } from '@/lib/utils'

const DOT_CLASSES: Record<CoverageStatus, string> = {
  [CoverageStatus.Grounded]: 'bg-leaf',
  [CoverageStatus.Partial]: 'bg-degraded',
  [CoverageStatus.Out]: 'bg-coverage-out',
}

/** Indicador de cobertura no composer, para a data de referência atual (some sem dados). */
export function CoverageIndicator({ date }: { readonly date: IsoDate }) {
  const t = useTranslations('chat.coverage')
  const { data } = useCoverage()
  if (data === undefined) return null
  const { status } = coverageAt(data.families, date)
  return (
    <span
      className="inline-flex items-center gap-1.5 text-muted-foreground text-xs"
      data-coverage={status}
    >
      <span className="relative flex size-2" aria-hidden="true">
        {status === CoverageStatus.Grounded && (
          <span className="absolute inset-0 rounded-full bg-leaf/50 motion-safe:animate-ping motion-safe:[animation-iteration-count:2]" />
        )}
        <span className={cn('relative size-2 rounded-full', DOT_CLASSES[status])} />
      </span>
      <span className="sr-only">{t('label')}: </span>
      <span className="hidden sm:inline">{t(status)}</span>
      <span className="sr-only sm:hidden">{t(status)}</span>
    </span>
  )
}

interface CoverageBannerProps {
  readonly status: CoverageStatus
  /** Famílias sem cobertura (cobertura parcial). */
  readonly families?: readonly string[]
  readonly className?: string
}

/** Aviso de cobertura parcial ou fora de cobertura; fundamentada não mostra nada. */
export function CoverageBanner({ status, families = [], className }: CoverageBannerProps) {
  const t = useTranslations('chat.coverage')
  if (status === CoverageStatus.Grounded) return null
  const Icon = status === CoverageStatus.Out ? CircleOffIcon : AlertTriangleIcon
  return (
    <div
      role="note"
      data-coverage={status}
      className={cn(
        'flex max-w-[70ch] items-start gap-2.5 rounded-xl border bg-popover px-3 py-2 text-sm',
        status === CoverageStatus.Out ? 'border-coverage-out/45' : 'border-degraded/45',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          status === CoverageStatus.Out ? 'text-coverage-out' : 'text-degraded',
        )}
      />
      <p>
        <span
          className={cn(
            'font-medium',
            status === CoverageStatus.Out ? 'text-coverage-out' : 'text-degraded',
          )}
        >
          {t(status)}.{' '}
        </span>
        {status === CoverageStatus.Out
          ? t('bannerOut')
          : t('bannerPartial', { families: families.join(', ') })}
      </p>
    </div>
  )
}

/** Banner da data escolhida no composer (antes de enviar), no topo do bloco do composer. */
export function ComposerCoverageBanner({ date }: { readonly date: IsoDate }) {
  const { data } = useCoverage()
  if (data === undefined) return null
  const { status, uncovered } = coverageAt(data.families, date)
  return status === CoverageStatus.Out ? (
    <CoverageBanner status={status} families={uncovered} className="m-2 mb-0 max-w-none" />
  ) : null
}
