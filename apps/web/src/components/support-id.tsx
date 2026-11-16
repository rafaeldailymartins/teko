'use client'

import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface SupportIdProps {
  /** `trace_id` da requisição na API (`x-trace-id` ou `traceId` do Problem Details). */
  readonly traceId: string | null
  readonly className?: string
}

/**
 * "ID de suporte" de um erro da API: o `trace_id` que liga a mensagem ao trace no Grafana e no
 * Langfuse. Selecionável inteiro (um clique), para colar num relato de problema. Sem id (falha de
 * rede, sem resposta), nada aparece.
 */
export function SupportId({ traceId, className }: SupportIdProps) {
  const t = useTranslations('common')
  if (traceId === null) {
    return null
  }
  return (
    <p className={cn('text-muted-foreground text-xs', className)} data-support-id={traceId}>
      {t('supportId')}: <code className="select-all font-mono">{traceId}</code>
    </p>
  )
}
