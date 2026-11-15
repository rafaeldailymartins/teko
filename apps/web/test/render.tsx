import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { NextIntlClientProvider } from 'next-intl'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createQueryClient } from '@/lib/api/query-client'
import ptBR from '../messages/pt-BR.json'

/**
 * Render de componentes de cliente em happy-dom (arquivos com `// @vitest-environment happy-dom`):
 * next-intl em pt-BR, um `QueryClient` que o teste pode semear e o adapter de testes do nuqs com
 * a query inicial (e memória, para as atualizações valerem no próximo render).
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

export interface Rendered {
  readonly container: HTMLElement
  readonly client: QueryClient
  /** Atualizações de URL feitas pelo nuqs, na ordem (`?k=…`). */
  readonly urls: string[]
  unmount(): Promise<void>
}

export async function renderClient(
  ui: ReactNode,
  options: { readonly searchParams?: string; readonly client?: QueryClient } = {},
): Promise<Rendered> {
  const client = options.client ?? createQueryClient()
  const urls: string[] = []
  const container = document.createElement('div')
  document.body.append(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <QueryClientProvider client={client}>
          <NuqsTestingAdapter
            searchParams={options.searchParams ?? ''}
            hasMemory
            onUrlUpdate={(event) => urls.push(event.queryString)}
          >
            {ui}
          </NuqsTestingAdapter>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    )
  })
  return {
    container,
    client,
    urls,
    async unmount() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

/** Espera os efeitos, as consultas e as transições assentarem. */
export async function settle(ms = 20): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

export async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) {
    throw new Error('elemento não encontrado')
  }
  await act(async () => {
    element.click()
  })
  await settle()
}

export function byText(selector: string, text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text,
  )
}
