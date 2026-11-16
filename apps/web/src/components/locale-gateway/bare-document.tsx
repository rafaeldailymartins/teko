import { DEFAULT_LOCALE } from '@teko/shared/i18n'
import type { ReactNode } from 'react'
import { FONT_VARIABLES_CLASS_NAME } from '@/components/ui/fonts'
import { ThemeScript } from '@/components/ui/theme-script'

interface BareDocumentProps {
  /** Elementos do começo do `<body>`, depois do script de tema (`<noscript>`, scripts externos). */
  readonly head?: ReactNode
  readonly children: ReactNode
}

/**
 * Documento mínimo das páginas fora de locale (entrada `/` e 404 global). O texto aparece nos
 * dois idiomas, cada trecho com o próprio `lang`; o documento usa o locale padrão. Fontes e tema
 * seguem o layout de locale: as variáveis das fontes no `<html>` e o bootstrap de tema como
 * primeiro filho do `<body>`. Cada página traz o próprio `<main>`.
 */
export function BareDocument({ head, children }: BareDocumentProps) {
  return (
    <html lang={DEFAULT_LOCALE} className={FONT_VARIABLES_CLASS_NAME} suppressHydrationWarning>
      <body>
        <ThemeScript />
        {head}
        {children}
      </body>
    </html>
  )
}
