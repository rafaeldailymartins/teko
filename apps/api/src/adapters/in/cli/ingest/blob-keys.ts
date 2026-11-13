import type { Family } from '#domain/corpus/family.ts'
import type { SourceFormat } from './sources.ts'

/**
 * Chaves dos artefatos de fonte no `BlobStore` (ADR 0030; plano, "Escrita, Blobs, snapshot e promoção"):
 * `{family}/{docSlug}/{versionLabel}/{sha256}.{ext}`, no store `corpus-raw` (arquivo como baixado)
 * e `corpus-docling` (`{sha256}.json`, ou `{sha256}-p<início>-<fim>.json` por parte de
 * `page_range`, com `.x<revisão>` antes do `.json` a partir da revisão 2 do extrator). O segmento de versão é o rótulo curto da fonte (`3.2.4`, `5.9`, `2.1.2d`), ou,
 * nas fontes sem rótulo prévio, `v<versao>` (tabelas do WS) ou um slug do rótulo parseado
 * (consolidados).
 */

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '')
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

/**
 * Revisão do extrator (Docling e a configuração do `tools/ingest`), análoga à do parser (ADR 0026):
 * sobe quando a saída do Docling para um mesmo PDF muda (versão do `docling` no `uv.lock`,
 * TableFormer, OCR, opções do pipeline). Entra na chave do store `corpus-docling`, então uma
 * revisão nova faz o `discover` pedir a reextração e o cache antigo deixa de ser lido. A revisão 1
 * é a chave sem sufixo (as chaves gravadas antes da revisão continuam válidas). Tem de ser igual a
 * `EXTRACTOR_REVISION` de `tools/ingest/src/teko_ingest/manifest.py` (teste em `blob-keys.test.ts`).
 */
export const EXTRACTOR_REVISION = 1

/** Versão do `docling` no `tools/ingest/uv.lock` coberta pela {@link EXTRACTOR_REVISION}. */
export const EXTRACTOR_DOCLING_VERSION = '2.146.0'

export function doclingBlobKey(
  parts: SourceKeyParts,
  pageRange: string | null,
  extractorRevision: number = EXTRACTOR_REVISION,
): string {
  const revision = extractorRevision === 1 ? '' : `.x${String(extractorRevision)}`
  return `${prefix(parts)}/${doclingPartId(parts.sha256, pageRange)}${revision}.json`
}
