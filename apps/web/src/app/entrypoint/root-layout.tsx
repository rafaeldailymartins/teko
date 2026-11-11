import type { ReactNode } from 'react'
import '../styles/globals.css'

/**
 * Layout raiz de passagem: o `<html>` fica no layout de `[locale]` (que conhece o idioma) e nas
 * páginas fora de locale (entrada `/` e 404 global), como pede o next-intl no export estático.
 */
export function RootLayout({ children }: { readonly children: ReactNode }) {
  return children
}
