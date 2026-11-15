'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { AlertTriangleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCoverage } from '@/lib/api/hooks'
import { CoverageStatus, coverageAt } from '@/lib/chat/coverage'
import { cn } from '@/lib/utils'

const DOT_CLASSES: Record<CoverageStatus, string> = {
  [CoverageStatus.Grounded]: 'bg-validity-current',
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
      <span aria-hidden="true" className={cn('size-2 rounded-full', DOT_CLASSES[status])} />
      <span className="sr-only">{t('label')}: </span>
      {t(status)}
    </span>
  )
}

interface CoverageBannerProps {
  readonly status: CoverageStatus
  /** Famílias sem cobertura (cobertura parcial). */
  readonly families?: readonly string[]
}

/** Aviso de cobertura parcial ou fora de cobertura; fundamentada não mostra nada. */
export function CoverageBanner({ status, families = [] }: CoverageBannerProps) {
  const t = useTranslations('chat.coverage')
  if (status === CoverageStatus.Grounded) return null
  return (
    <div
      role="note"
      data-coverage={status}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        status === CoverageStatus.Out
          ? 'border-coverage-out text-coverage-out'
          : 'border-degraded text-degraded',
      )}
    >
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-medium">{t(status)}. </span>
        {status === CoverageStatus.Out
          ? t('bannerOut')
          : t('bannerPartial', { families: families.join(', ') })}
      </p>
    </div>
  )
}

/** Banner da data escolhida no composer (antes de enviar). */
export function ComposerCoverageBanner({ date }: { readonly date: IsoDate }) {
  const { data } = useCoverage()
  if (data === undefined) return null
  const { status, uncovered } = coverageAt(data.families, date)
  return status === CoverageStatus.Out ? (
    <CoverageBanner status={status} families={uncovered} />
  ) : null
}
