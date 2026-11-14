import { z } from 'zod'
import { isoDateSchema, validityIntervalSchema } from '../vigencia/schemas.ts'
import { familySchema, jurisdictionSchema, stableKeySchema } from './common.ts'

/**
 * Paleta de dispositivos, linha do tempo e diff entre redações (`/api/v1/provisions*`). Só leitura
 * do corpus publicado (o mesmo filtro de `review_status` da busca).
 */

/** Texto da busca da paleta: rótulo ("art. 76"), chave ("C170") ou trecho. */
export const PROVISION_QUERY_MAX_LENGTH = 120
/** Resultados da paleta por página. */
export const PROVISION_SEARCH_LIMIT = 20

export const provisionSearchQuerySchema = z
  .strictObject({
    q: z.string().trim().min(2).max(PROVISION_QUERY_MAX_LENGTH),
    family: familySchema.optional(),
    /** Data em que a redação deve estar vigente; ausente = hoje (America/Sao_Paulo). */
    at: isoDateSchema.optional(),
  })
  .meta({ description: 'Busca de dispositivos para a paleta' })
export type ProvisionSearchQuery = z.infer<typeof provisionSearchQuerySchema>

export const provisionSummarySchema = z.object({
  stableKey: stableKeySchema,
  /** Rótulo exibido na data pedida, ex.: "RCTE, art. 76, § 6º, II". */
  label: z.string().min(1),
  family: familySchema,
  jurisdiction: jurisdictionSchema,
  /** Vigência da redação encontrada na data. */
  validity: validityIntervalSchema,
  /** Começo do texto da redação (até 200 caracteres). */
  excerpt: z.string(),
})
export type ProvisionSummary = z.infer<typeof provisionSummarySchema>

export const provisionSearchResponseSchema = z
  .object({ at: isoDateSchema, items: z.array(provisionSummarySchema) })
  .meta({ description: 'Dispositivos vigentes na data que casam com a busca' })
export type ProvisionSearchResponse = z.infer<typeof provisionSearchResponseSchema>

export const provisionKeyParamsSchema = z.strictObject({ stableKey: stableKeySchema })
export type ProvisionKeyParams = z.infer<typeof provisionKeyParamsSchema>

/** Uma redação na linha do tempo do dispositivo. */
export const provisionVersionSchema = z.object({
  label: z.string().min(1),
  validity: validityIntervalSchema,
  text: z.string(),
  /** Ato que trouxe a redação, quando a fonte o informa (ex.: "Decreto nº 10.485/2024"). */
  act: z.string().min(1).nullable(),
  /** Campos dos registros, tabelas e eventos (`Nº`, `Campo`, `Tipo`...); `null` em texto legal. */
  fields: z.record(z.string(), z.string()).nullable(),
})
export type ProvisionVersion = z.infer<typeof provisionVersionSchema>

export const provisionTimelineResponseSchema = z
  .object({
    stableKey: stableKeySchema,
    family: familySchema,
    jurisdiction: jurisdictionSchema,
    /** Em ordem cronológica de vigência. */
    versions: z.array(provisionVersionSchema),
  })
  .meta({ description: 'Redações do dispositivo ao longo do tempo' })
export type ProvisionTimelineResponse = z.infer<typeof provisionTimelineResponseSchema>

export const provisionDiffQuerySchema = z
  .strictObject({ from: isoDateSchema, to: isoDateSchema })
  .refine((query) => query.from < query.to, {
    message: '"from" deve ser anterior a "to"',
    path: ['to'],
  })
  .meta({ description: 'Datas das duas redações comparadas' })
export type ProvisionDiffQuery = z.infer<typeof provisionDiffQuerySchema>

export const DiffOp = {
  Equal: 'equal',
  Insert: 'insert',
  Delete: 'delete',
} as const
export type DiffOp = (typeof DiffOp)[keyof typeof DiffOp]

export const diffSegmentSchema = z.object({ op: z.enum(DiffOp), text: z.string() })
export type DiffSegment = z.infer<typeof diffSegmentSchema>

export const fieldChangeSchema = z.object({
  field: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
})
export type FieldChange = z.infer<typeof fieldChangeSchema>

export const provisionDiffResponseSchema = z
  .object({
    stableKey: stableKeySchema,
    /** Redação vigente em `from` e em `to`; `null` quando o dispositivo não existia na data. */
    before: provisionVersionSchema.nullable(),
    after: provisionVersionSchema.nullable(),
    /** Diff por palavra entre os dois textos. */
    segments: z.array(diffSegmentSchema),
    /** Campos que mudaram (registros, tabelas e eventos); vazio em texto legal. */
    fieldChanges: z.array(fieldChangeSchema),
  })
  .meta({ description: 'Diferença entre as redações vigentes em duas datas' })
export type ProvisionDiffResponse = z.infer<typeof provisionDiffResponseSchema>
