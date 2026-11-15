'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { type ReactNode, useState } from 'react'
import { createQueryClient } from '@/lib/api/query-client'

/**
 * Providers de cliente da árvore de cada locale: cache de dados (TanStack Query, um `QueryClient`
 * por montagem) e estado na query string (nuqs, adapter do App Router).
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)
  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  )
}
