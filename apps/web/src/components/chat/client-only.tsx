'use client'

import { type ReactNode, Suspense, useSyncExternalStore } from 'react'

const subscribe = () => () => undefined

interface ClientOnlyProps {
  /** O que vai no HTML estático e fica na tela enquanto o código sob demanda carrega. */
  readonly fallback: ReactNode
  readonly children: ReactNode
}

/**
 * Renderiza os filhos só no navegador, depois da hidratação, dentro de um `Suspense`. Com um
 * `lazy(() => import(...))` dentro, o código fica num chunk sob demanda que nenhum HTML do export
 * carrega (fora do orçamento de first-load), sem o runtime do `next/dynamic`.
 */
export function ClientOnly({ fallback, children }: ClientOnlyProps) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  return isClient ? <Suspense fallback={fallback}>{children}</Suspense> : fallback
}
