import { isoDateSchema } from '@teko/shared/vigencia'
import { z } from 'zod'
import { FAMILIES } from '#domain/corpus/family.ts'
import { IngestTarget } from './cli-common.ts'
import { ParserName } from './parsers/parser.ts'
import { HTTP_PINNED_HOSTS, SourceFormat, SourceMode } from './sources.ts'

/**
 * Contratos de arquivo entre os jobs do `ingest.yml`:
 *
 * - `<out>/plan.json`: o que o `discover` baixou (um item por fonte, com o arquivo relativo à
 *   pasta do plano) e o que o `load` vai carregar;
 * - `<out>/extract-matrix.json`: as partes do Docling que faltam no store `corpus-docling`, no
 *   formato que o job `extract` valida (`id` = `<sha256>[-p<início>-<fim>]`, `file` relativo,
 *   `url` https, `pageRange`, `ocr`, `timeoutSeconds`).
 *
 * URL de download em http só nos hosts com exceção (ADR 0028), como no manifesto e no `SafeFetcher`.
 */

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)
const downloadUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine(
    (value) => value.startsWith('https://') || HTTP_PINNED_HOSTS.has(new URL(value).hostname),
    { error: 'http só nos hosts com exceção (ADR 0028)' },
  )
const relativeFileSchema = z
  .string()
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((value) => !value.includes('..') && !value.startsWith('/'), { error: 'caminho relativo' })

const externalTableSchema = z.strictObject({
  id: z.int().positive(),
  versao: z.int().positive(),
  desc: z.string().min(1),
  dtVersao: isoDateSchema,
  hash: z.string().regex(/^[0-9A-Fa-f]{40}$/),
})

const doclingPartSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{64}(-p\d+-\d+)?$/),
  pageRange: z
    .string()
    .regex(/^\d+-\d+$/)
    .nullable(),
  /** `true` quando o `docling.json` desta parte já estava no store `corpus-docling`. */
  cached: z.boolean(),
})

const planItemSchema = z.strictObject({
  sourceId: z.string().min(1),
  family: z.enum(FAMILIES),
  documentSlug: z.string().min(1),
  parser: z.enum(ParserName),
  mode: z.enum(SourceMode),
  format: z.enum(SourceFormat),
  version: z.string().nullable(),
  /** URL pedida (para tabelas do WS, com `idTabela` e `versao`) e URL final, depois de redirects. */
  url: downloadUrlSchema,
  finalUrl: downloadUrlSchema,
  sha256: sha256Schema,
  bytes: z.int().nonnegative(),
  file: relativeFileSchema,
  /** De onde vieram os bytes: da origem ou do store `corpus-raw` (fonte pinned já baixada antes). */
  origin: z.enum(['source', 'blobs']),
  externalTable: externalTableSchema.nullable(),
  docling: z.array(doclingPartSchema),
})
export type PlanItem = z.output<typeof planItemSchema>

const planErrorSchema = z.strictObject({
  sourceId: z.string().min(1),
  message: z.string().min(1),
})
export type PlanError = z.output<typeof planErrorSchema>

export const PLAN_FORMAT = 1

export const planSchema = z.strictObject({
  format: z.literal(PLAN_FORMAT),
  target: z.enum(IngestTarget),
  createdAt: z.iso.datetime({ offset: true }),
  families: z.array(z.enum(FAMILIES)),
  items: z.array(planItemSchema),
  errors: z.array(planErrorSchema),
})
export type Plan = z.output<typeof planSchema>

export interface ExtractMatrixItem {
  readonly id: string
  readonly file: string
  readonly sourceId: string
  readonly url: string
  readonly pageRange: string | null
  readonly ocr: boolean
  readonly timeoutSeconds: number
}

export const DEFAULT_DOCLING_TIMEOUT_S = 3600
/** Teto da matriz do `extract` (validado também no workflow). */
export const MAX_MATRIX_ITEMS = 256
