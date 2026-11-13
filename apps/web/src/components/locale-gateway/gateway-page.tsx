import { DEFAULT_LOCALE } from '@teko/shared/i18n'
import type { Metadata } from 'next'
import { localeHomePath } from '@/lib/i18n/routing'
import { PRODUCT_NAME } from '@/lib/site'
import { BareDocument } from './bare-document.tsx'
import { loadAllCatalogs, pickFromCatalogs } from './catalogs.ts'
import { LocaleLinks } from './locale-links.tsx'

/**
 * Sem `alternates.languages`: a página é `noindex` (o Google a deixa fora de grupos hreflang) e não
 * há `metadataBase` fora de `[locale]`, então os hreflang sairiam relativos, que o Google rejeita.
 * Fixar `SITE_ORIGIN` também não serve: esta página só é servida fora da Vercel, em outro host.
 * Os hreflang absolutos ficam nas páginas de cada locale.
 */
export const gatewayMetadata: Metadata = {
  title: PRODUCT_NAME,
  robots: { index: false, follow: true },
}

/**
 * Entrada `/` do export estático. Na Vercel a rota do `config.json` responde antes (302 por
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
