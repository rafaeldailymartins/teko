'use client'

import type { IsoDate } from '@teko/shared/vigencia'
import { AlertTriangleIcon, CircleOffIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCoverage } from '@/lib/api/hooks'
import { CoverageStatus, coverageAt } from '@/lib/chat/coverage'
import { familyMessageKey } from '@/lib/coverage'

/** Nome legível de cada família (o mesmo da página de cobertura); família nova fica com o código. */
function useFamilyNames(): (families: readonly string[]) => string {
  const t = useTranslations('coverage.families')
  const format = useFormatter()
  return (families) =>
    format.list(
      families.map((family) => {
        const key = familyMessageKey(family)
        return key === null ? family : t(`${key}.name`)
      }),
      { type: 'conjunction' },
    )
}

/**
 * Nota de cobertura parcial numa resposta: uma linha discreta com os nomes legíveis das famílias
 * sem fontes na data, no tom de alerta só no ícone.
 */
export function CoverageNote({ families }: { readonly families: readonly string[] }) {
  const t = useTranslations('chat.coverage')
  const names = useFamilyNames()
  return (
    <p
      role="note"
      data-coverage={CoverageStatus.Partial}
      className="flex max-w-[70ch] items-start gap-2 text-muted-foreground text-sm"
    >
      <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-degraded" />
      <span>{t('notePartial', { families: names(families) })}</span>
    </p>
  )
}

/**
 * Aviso de data fora da cobertura no topo do composer (antes de enviar): só aparece quando nenhuma
 * fonte cobre a data escolhida, sem impedir o envio.
 */
export function ComposerCoverageBanner({ date }: { readonly date: IsoDate }) {
  const t = useTranslations('chat.coverage')
  const { data } = useCoverage()
  if (data === undefined) return null
  const { status } = coverageAt(data.families, date)
  if (status !== CoverageStatus.Out) return null
  return (
    <p
      role="note"
      data-coverage={status}
      className="m-2 mb-0 flex items-start gap-2 rounded-xl border border-coverage-out/45 bg-popover px-3 py-2 text-sm"
    >
      <CircleOffIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coverage-out" />
      <span>
        <span className="font-medium text-coverage-out">{t('out')}. </span>
        {t('bannerOut')}
      </span>
    </p>
  )
}
