'use client'

import { CSPProvider } from '@base-ui/react/csp-provider'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

interface ProvidersProps {
  readonly children: ReactNode
}

/**
 * Providers de cliente de todas as páginas, montados no layout de locale (dentro do
 * `NextIntlClientProvider`). É aqui que entram os próximos, como o do TanStack Query.
 *
 * - `CSPProvider disableStyleElements`: o Base UI não injeta `<style>` em runtime (o CSP só aceita
 *   os inline com hash calculado no pós-build); a regra que ele injetaria está em `globals.css`.
 * - `TooltipProvider`: um atraso comum para todos os tooltips.
 */
export function Providers({ children }: ProvidersProps) {
  return (
    <CSPProvider disableStyleElements>
      <TooltipProvider>{children}</TooltipProvider>
    </CSPProvider>
  )
}
