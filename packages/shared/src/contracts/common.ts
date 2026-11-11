import { z } from 'zod'
import { isoDateSchema, validityIntervalSchema } from '../vigencia/schemas.ts'

/**
 * Enums e schemas básicos compartilhados pelas rotas. Convenção: requisições usam
 * `z.strictObject` (campo desconhecido = 400), respostas usam `z.object` (clientes toleram campos
 * novos).
 */

/** Ambiente de execução da API (`APP_ENV`). */
export const AppEnv = {
  Development: 'development',
  Ci: 'ci',
  Staging: 'staging',
  Production: 'production',
} as const
export type AppEnv = (typeof AppEnv)[keyof typeof AppEnv]
export const appEnvSchema = z.enum(AppEnv)

/** `lexical_only` quando o embedding falha ou estoura o timeout de 3 s. */
export const RetrievalMode = {
  Hybrid: 'hybrid',
  LexicalOnly: 'lexical_only',
} as const
export type RetrievalMode = (typeof RetrievalMode)[keyof typeof RetrievalMode]
export const retrievalModeSchema = z.enum(RetrievalMode)

/** Motivos de recusa. Recusa não é erro HTTP. */
export const RefusalReason = {
  OutOfCoverage: 'out_of_coverage',
  NoEvidence: 'no_evidence',
  ModelInsufficient: 'model_insufficient',
  CitationInvalid: 'citation_invalid',
} as const
export type RefusalReason = (typeof RefusalReason)[keyof typeof RefusalReason]
export const refusalReasonSchema = z.enum(RefusalReason)

/** Provedores de LLM (`fake` só fora de staging/produção). */
export const LlmProvider = {
  Gemini: 'gemini',
  Groq: 'groq',
  Fake: 'fake',
} as const
export type LlmProvider = (typeof LlmProvider)[keyof typeof LlmProvider]
export const llmProviderSchema = z.enum(LlmProvider)

export const Jurisdiction = {
  Federal: 'BR',
  Goias: 'GO',
} as const
export type Jurisdiction = (typeof Jurisdiction)[keyof typeof Jurisdiction]
export const jurisdictionSchema = z.enum(Jurisdiction)

/** Família do corpus em slug (`efd-icms-ipi`, `efd-reinf`, `rcte`, `cte`, `efd-go`, ...). */
export const familySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(40)
  .meta({ description: 'Slug da família do corpus', example: 'efd-icms-ipi' })

/**
 * Chave estável de dispositivo: jurisdição em minúsculas + segmentos separados por `:`
 * (`go:rcte:art:76:par:6:inc:II`, `br:efd-icms-ipi:reg:C170:campo:07`). A validação semântica
 * completa fica em `apps/api/src/domain/corpus/provision-id.ts`; aqui só o formato.
 */
export const stableKeySchema = z
  .string()
  .regex(/^(?:br|go):[a-z0-9-]+(?::[A-Za-z0-9-]+)*$/)
  .max(200)
  .meta({ description: 'Chave estável do dispositivo', example: 'go:rcte:art:76:par:6:inc:II' })

/** IDs são UUIDv7 gerados pelo Postgres (`uuidv7()`). */
export const idSchema = z.uuid()

export const familyCoverageSchema = z.object({
  family: familySchema,
  jurisdiction: jurisdictionSchema,
  /** Cobertura efetiva (já limitada por `verifiedAt` e sem lacunas), ordenada e disjunta. */
  covered: z.array(validityIntervalSchema),
  /** Último dia em que as fontes foram verificadas pelo `source-watch`. */
  verifiedAt: isoDateSchema,
})
export type FamilyCoverage = z.infer<typeof familyCoverageSchema>
