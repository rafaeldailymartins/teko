import { z } from 'zod'
import { ERROR_CODE_SPECS, ErrorCode, QuotaScope } from './codes.ts'

/**
 * Problem Details para APIs HTTP (RFC 9457), servido como `application/problem+json`.
 *
 * Membros padrão: `type`, `title`, `status`, `detail`, `instance`. Extensões do Tekó: `code`
 * (sempre presente, conjunto fechado), `traceId` (sempre presente, mostrado na UI como "ID de
 * suporte"), `meta` (só em `quota_exceeded`) e `errors` (só em `validation_error`).
 *
 * Recusa (fora de cobertura, sem evidência...) NÃO é erro HTTP: vai no corpo 200 da pergunta.
 */

export const PROBLEM_CONTENT_TYPE = 'application/problem+json'

/**
 * Prefixo do `type`. É uma tag URI (RFC 4151), que a RFC 9457 sugere para tipos que não são
 * desreferenciáveis: identifica o problema de forma estável sem prometer uma página na web. A
 * autoridade é o domínio de produção da API na Vercel (`teko-api.vercel.app`, fixado pelo deploy
 * placeholder da F0); o identificador não muda se a API for servida pelo Plano B (Render).
 */
export const PROBLEM_TYPE_PREFIX = 'tag:teko-api.vercel.app,2026:problems/'

export function problemTypeUri(code: ErrorCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`
}

export const errorCodeSchema = z.enum(ErrorCode)
export const quotaScopeSchema = z.enum(QuotaScope)

export const fieldErrorSchema = z.object({
  /** Caminho do campo em notação de pontos (`referenceDate`, `families.0`); vazio = corpo todo. */
  path: z.string(),
  message: z.string(),
})

export const quotaExceededMetaSchema = z.object({
  scope: quotaScopeSchema,
  /** Quando a cota volta (meia-noite em São Paulo), para a UI mostrar o horário de reset. */
  resetAt: z.iso.datetime({ offset: true }),
})

const problemBase = {
  type: z.string().min(1),
  title: z.string().min(1),
  status: z.int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  traceId: z.string().min(1),
}

// Em enums criados a partir de um objeto, `exclude` recebe as chaves do objeto, não os valores.
const otherCodeSchema = errorCodeSchema.exclude(['QuotaExceeded', 'ValidationError'])

export const problemDetailsSchema = z
  .discriminatedUnion('code', [
    z.object({
      ...problemBase,
      code: z.literal(ErrorCode.QuotaExceeded),
      meta: quotaExceededMetaSchema,
    }),
    z.object({
      ...problemBase,
      code: z.literal(ErrorCode.ValidationError),
      errors: z.array(fieldErrorSchema).optional(),
    }),
    z.object({ ...problemBase, code: otherCodeSchema }),
  ])
  .meta({ description: 'RFC 9457 problem details (application/problem+json)' })

export type ProblemDetails = z.infer<typeof problemDetailsSchema>
export type FieldError = z.infer<typeof fieldErrorSchema>
export type QuotaExceededMeta = z.infer<typeof quotaExceededMetaSchema>

interface ProblemInitBase {
  readonly traceId: string
  readonly detail?: string
  readonly instance?: string
  /** Sobrescreve o status padrão do código (ex.: 413/415 mapeados para `validation_error`). */
  readonly status?: number
}

export type ProblemInit =
  | (ProblemInitBase & {
      readonly code: typeof ErrorCode.QuotaExceeded
      readonly meta: QuotaExceededMeta
    })
  | (ProblemInitBase & {
      readonly code: typeof ErrorCode.ValidationError
      readonly errors?: readonly FieldError[]
    })
  | (ProblemInitBase & {
      readonly code: Exclude<
        ErrorCode,
        typeof ErrorCode.QuotaExceeded | typeof ErrorCode.ValidationError
      >
    })

/**
 * Monta e valida um problem+json com `type`, `title` e `status` derivados do código.
 * Lança `ZodError` se os dados forem inconsistentes (ex.: status fora de 4xx/5xx).
 */
export function createProblem(init: ProblemInit): ProblemDetails {
  const spec = ERROR_CODE_SPECS[init.code]
  return problemDetailsSchema.parse({
    ...init,
    type: problemTypeUri(init.code),
    title: spec.title,
    status: init.status ?? spec.status,
  })
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return problemDetailsSchema.safeParse(value).success
}

/** Converte os issues de um `ZodError` no formato `errors[]` de `validation_error`. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}
