import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import type { SafeFetcher } from '#app/ports/safe-fetcher.ts'
import { type Family, isFamily } from '#domain/corpus/family.ts'
import { doclingBlobKey, doclingPartId, rawBlobKey, type SourceKeyParts } from './blob-keys.ts'
import {
  CliUsageError,
  EXIT_FAILURE,
  EXIT_OK,
  errorMessage,
  type IngestTarget,
  isIngestTarget,
  sha256Hex,
} from './cli-common.ts'
import type { ExternalTableVersion } from './parsers/parser.ts'
import {
  DEFAULT_DOCLING_TIMEOUT_S,
  type ExtractMatrixItem,
  MAX_MATRIX_ITEMS,
  PLAN_FORMAT,
  type Plan,
  type PlanError,
  type PlanItem,
} from './plan.ts'
import {
  type CorpusConfig,
  DOCLING_FORMATS,
  type ResolvedSource,
  SourceMode,
  WS_TABELAS_DOWNLOAD_URL,
  WS_TABELAS_VERSIONS_URL,
} from './sources.ts'
import { parseTableVersions, tableDownloadUrl } from './ws-tabelas.ts'

/**
 * `cli ingest discover --target staging|production --out <dir> [--family <f>[,<f>…]]` (job
 * `discover` do `ingest.yml`). Para cada fonte habilitada de `corpus/sources.yaml`:
 *
 * 1. obtém os bytes: fonte `pinned` já gravada no store `corpus-raw` vem do Blobs (sem tocar a
 *    origem); as demais vêm da origem pelo `SafeFetcher` (tabelas: versão atual do WS);
 * 2. calcula o sha256 e confere o pin (`pinned` com sha256 diferente é erro: o arquivo publicado
 *    mudou e o `sources.yaml` precisa de revisão);
 * 3. grava o arquivo em `<out>/files/<sha256>.<ext>`;
 * 4. para PDF/XLSX, marca as partes (`page_ranges`) sem `docling.json` no store `corpus-docling`.
 *
 * Grava `<out>/plan.json` e `<out>/extract-matrix.json` mesmo com erros (para o diagnóstico) e
 * termina com código 1 se alguma fonte falhou.
 */

const DISCOVER_USAGE =
  'uso: cli ingest discover --target staging|production --out <dir> [--family <família>[,<família>…]]'

export interface IngestDiscoverDeps {
  readonly config: CorpusConfig
  readonly fetcher: SafeFetcher
  readonly blobs: BlobStore
  readonly now?: () => Date
  /** Saída de uma linha (o `cli.ts` passa `console.log`). */
  readonly print: (line: string) => void
}

export interface DiscoverArgs {
  readonly target: IngestTarget
  readonly out: string
  readonly families: readonly Family[]
}

function parseFamilies(values: readonly string[], usage: string): Family[] {
  const families = values.flatMap((value) => value.split(',')).map((value) => value.trim())
  const invalid = families.filter((family) => !isFamily(family))
  if (invalid.length > 0) {
    throw new CliUsageError(`família desconhecida: ${invalid.join(', ')}`, usage)
  }
  return [...new Set(families)].filter(isFamily)
}

export function parseDiscoverArgs(args: readonly string[]): DiscoverArgs {
  let values: { target?: string; out?: string; family?: string[] }
  try {
    values = parseArgs({
      args: [...args],
      options: {
        target: { type: 'string' },
        out: { type: 'string' },
        family: { type: 'string', multiple: true },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new CliUsageError(errorMessage(error), DISCOVER_USAGE)
  }
  if (!isIngestTarget(values.target)) {
    throw new CliUsageError('--target precisa ser staging ou production', DISCOVER_USAGE)
  }
  if (values.out === undefined || values.out.trim() === '') {
    throw new CliUsageError('--out é obrigatório', DISCOVER_USAGE)
  }
  return {
    target: values.target,
    out: values.out,
    families: parseFamilies(values.family ?? [], DISCOVER_USAGE),
  }
}

class PinMismatchError extends Error {
  constructor(sourceId: string, expected: string, actual: string) {
    super(`${sourceId}: sha256 ${actual} diferente do pin ${expected} em corpus/sources.yaml`)
    this.name = 'PinMismatchError'
  }
}

class DownloadError extends Error {
  constructor(sourceId: string, status: number, url: string) {
    super(`${sourceId}: HTTP ${String(status)} em ${url}`)
    this.name = 'DownloadError'
  }
}

interface Fetched {
  readonly bytes: Uint8Array
  readonly url: string
  readonly finalUrl: string
  readonly origin: 'source' | 'blobs'
}

function keyParts(source: ResolvedSource, sha256: string, version: string): SourceKeyParts {
  return { family: source.family, documentSlug: source.document.slug, version, sha256 }
}

async function fromBlobs(blobs: BlobStore, source: ResolvedSource): Promise<Fetched | null> {
  if (source.mode !== SourceMode.Pinned || source.sha256 === null || source.version === null) {
    return null
  }
  const key = rawBlobKey(keyParts(source, source.sha256, source.version), source.format)
  const bytes = await blobs.get(BlobStoreName.CorpusRaw, key)
  if (bytes === null || sha256Hex(bytes) !== source.sha256) {
    return null
  }
  return { bytes, url: source.url, finalUrl: source.url, origin: 'blobs' }
}

async function fromSource(
  fetcher: SafeFetcher,
  source: ResolvedSource,
  url: string,
): Promise<Fetched> {
  const response = await fetcher.fetch({ url })
  if (response.status !== 200) {
    throw new DownloadError(source.id, response.status, url)
  }
  return { bytes: response.body, url, finalUrl: response.url, origin: 'source' }
}

async function doclingParts(
  blobs: BlobStore,
  source: ResolvedSource,
  sha256: string,
): Promise<PlanItem['docling']> {
  if (!DOCLING_FORMATS.has(source.format)) {
    return []
  }
  const version = source.version ?? sha256
  const ranges = source.pageRanges.length === 0 ? [null] : source.pageRanges
  const parts: PlanItem['docling'][number][] = []
  for (const pageRange of ranges) {
    const key = doclingBlobKey(keyParts(source, sha256, version), pageRange)
    const existing = await blobs.list(BlobStoreName.CorpusDocling, key)
    parts.push({ id: doclingPartId(sha256, pageRange), pageRange, cached: existing.includes(key) })
  }
  return parts
}

export async function runIngestDiscover(
  deps: IngestDiscoverDeps,
  args: readonly string[],
): Promise<number> {
  const parsed = parseDiscoverArgs(args)
  const now = deps.now ?? (() => new Date())
  const wanted = new Set(parsed.families)
  const sources = deps.config.resolved.filter(
    (source) => wanted.size === 0 || wanted.has(source.family),
  )
  const filesDir = join(parsed.out, 'files')
  mkdirSync(filesDir, { recursive: true })

  const items: PlanItem[] = []
  const errors: PlanError[] = []
  const matrix: ExtractMatrixItem[] = []
  let tables: ReadonlyMap<number, ExternalTableVersion> | null = null
  let tablesError: string | null = null

  for (const source of sources) {
    try {
      let url = source.url
      let externalTable: ExternalTableVersion | null = null
      if (source.mode === SourceMode.WsTabela) {
        if (tables === null && tablesError === null) {
          try {
            const response = await deps.fetcher.fetch({ url: WS_TABELAS_VERSIONS_URL })
            if (response.status !== 200) {
              throw new DownloadError('ws-tabelas', response.status, WS_TABELAS_VERSIONS_URL)
            }
            tables = parseTableVersions(new TextDecoder().decode(response.body))
          } catch (error) {
            tablesError = errorMessage(error)
          }
        }
        externalTable = tables?.get(source.wsTableId ?? 0) ?? null
        if (externalTable === null) {
          throw new Error(
            tablesError ??
              `tabela ${String(source.wsTableId)} ausente do consultarVersoesTabelasExternas`,
          )
        }
        url = tableDownloadUrl(WS_TABELAS_DOWNLOAD_URL, externalTable)
      }
      const fetched =
        (await fromBlobs(deps.blobs, source)) ?? (await fromSource(deps.fetcher, source, url))
      const sha256 = sha256Hex(fetched.bytes)
      if (source.mode === SourceMode.Pinned && source.sha256 !== null && source.sha256 !== sha256) {
        throw new PinMismatchError(source.id, source.sha256, sha256)
      }
      const file = `files/${sha256}.${source.format}`
      writeFileSync(join(parsed.out, file), fetched.bytes)
      const docling = await doclingParts(deps.blobs, source, sha256)
      for (const part of docling.filter((entry) => !entry.cached)) {
        matrix.push({
          id: part.id,
          file,
          sourceId: source.id,
          url: fetched.finalUrl,
          pageRange: part.pageRange,
          ocr: source.ocr,
          timeoutSeconds: source.timeoutSeconds ?? DEFAULT_DOCLING_TIMEOUT_S,
        })
      }
      items.push({
        sourceId: source.id,
        family: source.family,
        documentSlug: source.document.slug,
        parser: source.parser,
        mode: source.mode,
        format: source.format,
        version: source.version,
        url: fetched.url,
        finalUrl: fetched.finalUrl,
        sha256,
        bytes: fetched.bytes.byteLength,
        file,
        origin: fetched.origin,
        externalTable,
        docling,
      })
    } catch (error) {
      errors.push({ sourceId: source.id, message: errorMessage(error) })
    }
  }

  if (matrix.length > MAX_MATRIX_ITEMS) {
    errors.push({
      sourceId: '(matriz)',
      message: `${String(matrix.length)} partes para o Docling (teto ${String(MAX_MATRIX_ITEMS)}): rode por família`,
    })
  }
  const plan: Plan = {
    format: PLAN_FORMAT,
    target: parsed.target,
    createdAt: now().toISOString(),
    families:
      parsed.families.length === 0
        ? [...new Set(sources.map((source) => source.family))]
        : [...parsed.families],
    items,
    errors,
  }
  writeFileSync(join(parsed.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`)
  writeFileSync(
    join(parsed.out, 'extract-matrix.json'),
    `${JSON.stringify(matrix.slice(0, MAX_MATRIX_ITEMS), null, 2)}\n`,
  )
  deps.print(
    JSON.stringify({
      discovered: items.length,
      fromBlobs: items.filter((item) => item.origin === 'blobs').length,
      doclingParts: matrix.length,
      errors,
    }),
  )
  return errors.length > 0 ? EXIT_FAILURE : EXIT_OK
}
