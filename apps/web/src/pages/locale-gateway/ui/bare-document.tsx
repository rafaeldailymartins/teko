import { DEFAULT_LOCALE } from '@teko/shared/i18n'
import type { ReactNode } from 'react'
import { MAIN_CONTENT_ID, PRODUCT_NAME } from '@/shared/config'
import { FONT_VARIABLES_CLASS_NAME, ThemeScript } from '@/shared/ui'

interface BareDocumentProps {
  /** `<meta>`/`<title>` extras: o React 19 os eleva para o `<head>`. */
  readonly head?: ReactNode
  readonly children: ReactNode
}

/**
 * Documento mínimo das páginas fora de locale (entrada `/` e 404 global). O texto aparece nos
 * dois idiomas, cada trecho com o próprio `lang`; o documento usa o locale padrão. Fontes e tema
 * seguem o layout de locale: as variáveis das fontes no `<html>` e o bootstrap de tema como
 * primeiro filho do `<body>`.
 */
export function BareDocument({ head, children }: BareDocumentProps) {
  return (
    <html lang={DEFAULT_LOCALE} className={FONT_VARIABLES_CLASS_NAME} suppressHydrationWarning>
      <body>
        <ThemeScript />
        {head}
        <main
          id={MAIN_CONTENT_ID}
          className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-5 py-16"
        >
          <p className="font-semibold font-serif text-3xl tracking-tight">{PRODUCT_NAME}</p>
          {children}
        </main>
      </body>
    </html>
  )
}
