import { DEFAULT_LOCALE } from '@teko/shared/i18n'
import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@/shared/config'
import { localeHomePath } from '@/shared/i18n'
import { BareDocument } from './bare-document.tsx'
import { loadAllCatalogs, pickFromCatalogs } from './catalogs.ts'
import { LocaleLinks } from './locale-links.tsx'

/**
 * Sem `alternates.languages`: a página é `noindex` (o Google a deixa fora de grupos hreflang) e não
 * há `metadataBase` fora de `[locale]`, então os hreflang sairiam relativos, que o Google rejeita.
 * Fixar `SITE_ORIGIN` também não serve: esta página só é servida fora da Netlify, em outro host.
 * Os hreflang absolutos ficam nas páginas de cada locale.
 */
export const gatewayMetadata: Metadata = {
  title: PRODUCT_NAME,
  robots: { index: false, follow: true },
}

/**
 * Entrada `/` do export estático. Na Netlify o `_redirects` responde antes (302 por
 * `Accept-Language`); esta página cobre qualquer outro servidor estático: redireciona para o
 * locale padrão por `<meta refresh>` e oferece os links dos dois idiomas, sem JavaScript.
 */
export async function GatewayPage() {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.gateway.title)

  return (
    <BareDocument
      head={<meta httpEquiv="refresh" content={`0; url=${localeHomePath(DEFAULT_LOCALE)}`} />}
    >
      <h1 className="text-muted-foreground text-xl">
        <span lang="pt-BR">{titles['pt-BR']}</span> / <span lang="en">{titles.en}</span>
      </h1>
      <LocaleLinks labels={pickFromCatalogs(catalogs, (messages) => messages.gateway.continue)} />
    </BareDocument>
  )
}
