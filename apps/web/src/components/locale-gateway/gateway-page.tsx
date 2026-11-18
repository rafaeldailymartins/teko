import { DEFAULT_LOCALE } from '@teko/shared/i18n'
import type { Metadata } from 'next'
import { TekoLogo } from '@/components/brand/teko-logo'
import { localeHomePath } from '@/lib/i18n/routing'
import { MAIN_CONTENT_ID, PRODUCT_NAME, SITE_ICONS } from '@/lib/site'
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
  icons: SITE_ICONS,
  robots: { index: false, follow: true },
}

/**
 * Script que escolhe o idioma no navegador (`public/root-locale.js`): externo, porque a CSP só
 * aceita script inline com hash e o Semgrep só abre exceção para o de tema.
 */
export const ROOT_LOCALE_SCRIPT = '/root-locale.js'

/**
 * Entrada `/` do export estático. Na Vercel e no Caddy o servidor responde antes (302
 * por `Accept-Language`); esta página só aparece em outro servidor estático. Ela não oferece escolha
 * de idioma: é uma tela neutra com a logo, e o script vai na hora para o idioma do navegador. Sem
 * JavaScript, o `<meta refresh>` leva ao locale padrão, e os links dos dois idiomas ficam no
 * `<noscript>`.
 */
export async function GatewayPage() {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.gateway.title)

  return (
    <BareDocument
      head={
        <>
          <noscript>
            <meta httpEquiv="refresh" content={`0; url=${localeHomePath(DEFAULT_LOCALE)}`} />
          </noscript>
          <script src={ROOT_LOCALE_SCRIPT} />
        </>
      }
    >
      <main
        id={MAIN_CONTENT_ID}
        className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-brand-glow px-5 py-16"
      >
        <h1 className="sr-only">{PRODUCT_NAME}</h1>
        <TekoLogo variant="seal" className="size-20 rounded-[1.25rem] shadow-raised" />
        <noscript>
          <div className="flex flex-col items-center gap-5 text-center">
            <p className="text-lg text-muted-foreground">
              <span lang="pt-BR">{titles['pt-BR']}</span> / <span lang="en">{titles.en}</span>
            </p>
            <LocaleLinks
              labels={pickFromCatalogs(catalogs, (messages) => messages.gateway.continue)}
            />
          </div>
        </noscript>
      </main>
    </BareDocument>
  )
}
