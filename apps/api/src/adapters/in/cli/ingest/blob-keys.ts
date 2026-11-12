import type { Family } from '#domain/corpus/family.ts'
import type { SourceFormat } from './sources.ts'

/**
 * Chaves dos artefatos de fonte no Netlify Blobs (plano, "Escrita, Blobs, snapshot e promoção"):
 * `{family}/{docSlug}/{versionLabel}/{sha256}.{ext}`, no store `corpus-raw` (arquivo como baixado)
 * e `corpus-docling` (`{sha256}.json`, ou `{sha256}-p<início>-<fim>.json` por parte de
 * `page_range`). O segmento de versão é o rótulo curto da fonte (`3.2.4`, `5.9`, `2.1.2d`), ou,
 * nas fontes sem rótulo prévio, `v<versao>` (tabelas do WS) ou um slug do rótulo parseado
 * (consolidados).
 */

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

export interface SourceKeyParts {
  readonly family: Family
  readonly documentSlug: string
  readonly version: string
  readonly sha256: string
}

/** Id de uma parte do Docling: `<sha256>` ou `<sha256>-p<início>-<fim>` (o mesmo do `tools/ingest`). */
export function doclingPartId(sha256: string, pageRange: string | null): string {
  return pageRange === null ? sha256 : `${sha256}-p${pageRange}`
}

function prefix(parts: SourceKeyParts): string {
  return `${parts.family}/${parts.documentSlug}/${slugify(parts.version)}`
}

export function rawBlobKey(parts: SourceKeyParts, format: SourceFormat): string {
  return `${prefix(parts)}/${parts.sha256}.${format}`
}

export function doclingBlobKey(parts: SourceKeyParts, pageRange: string | null): string {
  return `${prefix(parts)}/${doclingPartId(parts.sha256, pageRange)}.json`
}
