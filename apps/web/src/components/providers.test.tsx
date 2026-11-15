import { useQueryClient } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STALE_TIME_MS } from '@/lib/api/query-client'
import { Providers } from './providers'

function StaleTime() {
  return <span>{String(useQueryClient().getDefaultOptions().queries?.staleTime)}</span>
}

describe('Providers', () => {
  it('entrega o QueryClient da camada de dados aos filhos', () => {
    const html = renderToStaticMarkup(
      <Providers>
        <StaleTime />
      </Providers>,
    )
    expect(html).toBe(`<span>${String(STALE_TIME_MS)}</span>`)
  })
})
