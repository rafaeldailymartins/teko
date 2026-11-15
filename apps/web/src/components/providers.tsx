'use client'

import { CSPProvider } from '@base-ui/react/csp-provider'
import { QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { type ReactNode, useState } from 'react'
import { ConsentProvider } from '@/components/consent/consent-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/lib/api/query-client'

interface ProvidersProps {
  readonly children: ReactNode
}

/**
 * Providers de cliente de todas as páginas, montados no layout de locale (dentro do
 * `NextIntlClientProvider`).
 *
 * - `CSPProvider disableStyleElements`: o Base UI não injeta `<style>` em runtime (o CSP só aceita
 *   os inline com hash calculado no pós-build); a regra que ele injetaria está em `globals.css`.
 * - `TooltipProvider`: um atraso comum para todos os tooltips.
 * - TanStack Query: cache de dados, um `QueryClient` por montagem.
 * - nuqs: estado na query string, adapter do App Router.
 * - Consentimento LGPD: banner, preferências e o único ponto que liga o analytics.
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(createQueryClient)
  return (
    <CSPProvider disableStyleElements>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <TooltipProvider>
            <ConsentProvider>{children}</ConsentProvider>
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </CSPProvider>
  )
}
