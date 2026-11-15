'use client'

import { useSyncExternalStore } from 'react'

/** Largura a partir da qual o app shell mostra os três painéis (o `md` do Tailwind). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 48rem)'

/**
 * Se a media query casa. No HTML estático (sem `window`) vale `serverValue`; depois da hidratação,
 * o valor real, que acompanha as mudanças (girar o aparelho, redimensionar a janela).
 */
export function useMediaQuery(query: string, serverValue: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  )
}
