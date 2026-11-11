import type { Metadata } from 'next'
import { PRODUCT_NAME } from '@/shared/config'
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
  return { title: `${titles['pt-BR']} / ${titles.en} · ${PRODUCT_NAME}` }
}

/** 404 fora de qualquer locale (`out/404.html`), nos dois idiomas. */
export async function GlobalNotFoundPage() {
  const catalogs = await loadAllCatalogs()
  const titles = pickFromCatalogs(catalogs, (messages) => messages.notFound.title)

  return (
    <BareDocument>
      <h1 className="text-xl">
        <span lang="pt-BR">{titles['pt-BR']}</span> / <span lang="en">{titles.en}</span>
      </h1>
      <LocaleLinks labels={pickFromCatalogs(catalogs, (messages) => messages.notFound.backHome)} />
    </BareDocument>
  )
}
