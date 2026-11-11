import { z } from 'zod'
import { type ErrorCode, isRetryable } from '../errors/codes.ts'
import { errorCodeSchema } from '../errors/problem-details.ts'
import { citationSchema } from './citations.ts'
import { answerMetaSchema, refusalSchema, resolvedReferenceDateSchema } from './questions.ts'

/**
 * Chunks do UI Message Stream v1 (pacote `ai`) que o writer da API emite em
 * `POST /api/v1/questions/:id/stream`, na ordem:
 * `start` → `data-reference-date` → `data-meta` → `data-citation`* → `text-start` →
 * `text-delta`* → `text-end` → `data-refusal`? → `finish` | `error`.
 *
 * O formato dos chunks segue o protocolo do AI SDK (`type`, `id`, `data`, `delta`, `errorText`);
 * o teste de contrato da API confere cada chunk também contra o `uiMessageChunkSchema` do `ai`.
 */

/** Cabeçalhos da resposta do stream, enviados antes de qualquer I/O. */
export const UI_MESSAGE_STREAM_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
  'x-vercel-ai-ui-message-stream': 'v1',
} as const

/** Comentário SSE de heartbeat, a cada 15 s. */
export const SSE_HEARTBEAT = ': hb\n\n'

/** Marcador final do UI Message Stream. */
export const SSE_DONE = 'data: [DONE]\n\n'

/** Nomes dos data parts do Tekó (`type` dos chunks `data-*`). */
export const DataPartType = {
  ReferenceDate: 'data-reference-date',
  Meta: 'data-meta',
  Citation: 'data-citation',
  Refusal: 'data-refusal',
} as const
export type DataPartType = (typeof DataPartType)[keyof typeof DataPartType]

/** Payloads dos data parts, indexados pelo nome sem o prefixo `data-` (tipagem do `useChat`). */
export const tekoDataPartSchemas = {
  'reference-date': resolvedReferenceDateSchema,
  meta: answerMetaSchema,
  citation: citationSchema,
  refusal: refusalSchema,
} as const

export type TekoDataParts = {
  [K in keyof typeof tekoDataPartSchemas]: z.infer<(typeof tekoDataPartSchemas)[K]>
}

/** `messageMetadata` do chunk `finish`. */
export const finishMetadataSchema = z.object({
  usage: z.object({
    inputTokens: z.int().nonnegative(),
    outputTokens: z.int().nonnegative(),
  }),
  model: z.string().min(1),
  traceId: z.string().min(1),
})
export type FinishMetadata = z.infer<typeof finishMetadataSchema>

/** Conteúdo de `errorText` do chunk `error`, serializado como JSON. */
export const streamErrorSchema = z.object({
  code: errorCodeSchema,
  retryable: z.boolean(),
})
export type StreamError = z.infer<typeof streamErrorSchema>

const textPartId = z.string().min(1)

export const tekoStreamChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), messageId: z.string().min(1) }),
  z.object({
    type: z.literal(DataPartType.ReferenceDate),
    id: z.string().min(1).optional(),
    data: resolvedReferenceDateSchema,
  }),
  z.object({
    type: z.literal(DataPartType.Meta),
    id: z.string().min(1).optional(),
    data: answerMetaSchema,
  }),
  z
    .object({ type: z.literal(DataPartType.Citation), id: z.string().min(1), data: citationSchema })
    .refine((chunk) => chunk.id === chunk.data.id, {
      message: 'O id do data part deve ser o id da citação (S1, S2, ...)',
      path: ['id'],
    }),
  z.object({ type: z.literal('text-start'), id: textPartId }),
  z.object({ type: z.literal('text-delta'), id: textPartId, delta: z.string() }),
  z.object({ type: z.literal('text-end'), id: textPartId }),
  z.object({
    type: z.literal(DataPartType.Refusal),
    id: z.string().min(1).optional(),
    data: refusalSchema,
  }),
  z.object({ type: z.literal('finish'), messageMetadata: finishMetadataSchema }),
  z.object({ type: z.literal('error'), errorText: z.string() }),
])

export type TekoStreamChunk = z.infer<typeof tekoStreamChunkSchema>

/** Linha SSE de um chunk: `data: <json>\n\n`. */
export function encodeSseChunk(chunk: TekoStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/** Chunk `error` com `{code, retryable}` serializado em `errorText`. */
export function createStreamErrorChunk(
  code: ErrorCode,
  retryable: boolean = isRetryable(code),
): TekoStreamChunk {
  const payload: StreamError = { code, retryable }
  return { type: 'error', errorText: JSON.stringify(payload) }
}

/**
 * Lê o `errorText` de um chunk `error`. Devolve `null` se não for um erro do Tekó (ex.: erro
 * genérico do transporte), e a UI mostra a mensagem de `internal`.
 */
export function parseStreamError(errorText: string): StreamError | null {
  try {
    const parsed = streamErrorSchema.safeParse(JSON.parse(errorText))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}
