import type { Metadata } from 'next'
import { TekoWordmark } from '@/components/brand/teko-logo'
import { MAIN_CONTENT_ID, PRODUCT_NAME, SITE_ICONS } from '@/lib/site'
import { BareDocument } from './bare-document.tsx'
import { loadAllCatalogs, pickFromCatalogs } from './catalogs.ts'
import { LocaleLinks } from './locale-links.tsx'

/**
 * Título do 404 global nos dois idiomas (WCAG 2.4.2). Fora de `[locale]` não há o template de
 * título do layout de locale, então o nome do produto entra aqui. O `noindex` o Next já injeta.
 */
export async function generateGlobalNotFoundMetadata(): Promise<Metadata> {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.notFound.title)
  return { title: `${titles['pt-BR']} / ${titles.en} · ${PRODUCT_NAME}`, icons: SITE_ICONS }
}

/** 404 fora de qualquer locale (`out/404.html`), nos dois idiomas. */
export async function GlobalNotFoundPage() {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.notFound.title)

  return (
    <BareDocument>
      <main
        id={MAIN_CONTENT_ID}
        className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-5 py-16"
      >
        <TekoWordmark />
        <p className="font-mono text-muted-foreground text-sm tabular-nums">404</p>
        <h1 className="text-balance font-semibold font-serif text-3xl tracking-tight">
          <span lang="pt-BR">{titles['pt-BR']}</span> / <span lang="en">{titles.en}</span>
        </h1>
        <LocaleLinks
          labels={pickFromCatalogs(catalogs, (messages) => messages.notFound.backHome)}
        />
      </main>
    </BareDocument>
  )
}
