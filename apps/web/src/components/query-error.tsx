'use client'

import { useTranslations } from 'next-intl'
import { SupportId } from '@/components/support-id'
import { Button } from '@/components/ui/button'
import type { ApiError } from '@/lib/api/errors'

interface QueryErrorProps {
  readonly error: ApiError
  readonly onRetry: () => void
  /** Texto do botão de nova tentativa (cada tela tem o seu no catálogo). */
  readonly retryLabel: string
}

/**
 * Erro de uma consulta: a mensagem de `errors.<code>`, o "ID de suporte" (quando a API respondeu)
 * e, quando o erro é repetível, o botão que tenta de novo. Usado pela cobertura, pelo "O que mudou" e pela linha do tempo do painel.
 */
export function QueryError({ error, onRetry, retryLabel }: QueryErrorProps) {
  const t = useTranslations()
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm">
      <p className="text-muted-foreground">{t(error.messageKey)}</p>
      <SupportId traceId={error.traceId} />
      {error.retryable && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
