import {
  type Answer,
  type AnswerMeta,
  type Citation,
  ClarificationReason,
  type FinishMetadata,
  type QuestionDetail,
  type Refusal,
  type ResolvedReferenceDate,
  RetrievalMode,
  type TekoDataParts,
  tekoDataPartSchemas,
} from '@teko/shared/contracts'
import { intersect, isoDateSchema, type ValidityInterval } from '@teko/shared/vigencia'
import type { UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'

/**
 * Mensagens do chat no formato do `useChat` (AI SDK): os data parts do Tekó (`@teko/shared`) mais
 * um só do cliente, `data-clarification`, que o transporte sintetiza a partir de
 * `needs_clarification` (a API não manda esse chunk: a resposta é síncrona). Aqui também ficam a
 * leitura de uma mensagem para a tela e a montagem de partes e chunks a partir das respostas
 * síncronas e do histórico (`GET /questions/:id`).
 */

const clarificationSchema = z.object({
  reason: z.enum(ClarificationReason),
  candidates: z.array(isoDateSchema).min(2),
})
export type Clarification = z.infer<typeof clarificationSchema>

/** Schemas dos data parts para o `useChat({ dataPartSchemas })`. */
export const chatDataPartSchemas = {
  ...tekoDataPartSchemas,
  clarification: clarificationSchema,
} as const

type ChatDataParts = TekoDataParts & { clarification: Clarification }

/** Mensagem do chat: metadados do `finish` (uso, modelo, traceId) e os data parts acima. */
export type TekoUIMessage = UIMessage<FinishMetadata, ChatDataParts>
export type TekoMessagePart = TekoUIMessage['parts'][number]

type DataPart = Extract<TekoMessagePart, { type: `data-${string}` }>

/** Uma mensagem do assistente lida para a tela. */
export interface AnswerView {
  /** Markdown da resposta (citações como links `cite:S1`). */
  readonly text: string
  readonly reference: ResolvedReferenceDate | null
  readonly meta: AnswerMeta | null
  /** Citações na ordem S1, S2, ...; a mais recente de cada `id` vale (o validador atualiza). */
  readonly citations: readonly Citation[]
  readonly refusal: Refusal | null
  readonly clarification: Clarification | null
}

function citationOrder(citation: Citation): number {
  return Number(citation.id.slice(1))
}

export function answerView(message: TekoUIMessage): AnswerView {
  let text = ''
  let reference: ResolvedReferenceDate | null = null
  let meta: AnswerMeta | null = null
  let refusal: Refusal | null = null
  let clarification: Clarification | null = null
  const citations = new Map<string, Citation>()
  for (const part of message.parts) {
    switch (part.type) {
      case 'text':
        text += part.text
        break
      case 'data-reference-date':
        reference = part.data
        break
      case 'data-meta':
        meta = part.data
        break
      case 'data-citation':
        citations.set(part.data.id, part.data)
        break
      case 'data-refusal':
        refusal = part.data
        break
      case 'data-clarification':
        clarification = part.data
        break
      default:
        break
    }
  }
  return {
    text,
    reference,
    meta,
    citations: [...citations.values()].sort((a, b) => citationOrder(a) - citationOrder(b)),
    refusal,
    clarification,
  }
}

/** Texto de uma mensagem (as partes `text` concatenadas). */
export function messageText(message: Pick<TekoUIMessage, 'parts'>): string {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('')
}

export const DegradationLabel = {
  LexicalOnly: 'lexicalOnly',
  Fallback: 'fallback',
  Cached: 'cached',
} as const
export type DegradationLabel = (typeof DegradationLabel)[keyof typeof DegradationLabel]

/** Rótulos de degradação de `data-meta`: busca só lexical, modelo de reserva, resposta em cache. */
export function degradationLabels(meta: AnswerMeta | null): DegradationLabel[] {
  if (meta === null) {
    return []
  }
  const labels: DegradationLabel[] = []
  if (meta.retrievalMode === RetrievalMode.LexicalOnly) labels.push(DegradationLabel.LexicalOnly)
  if (meta.fallbackFrom !== null) labels.push(DegradationLabel.Fallback)
  if (meta.cached) labels.push(DegradationLabel.Cached)
  return labels
}

/**
 * Vigência usada na resposta: a interseção dos intervalos das citações válidas, isto é, o período
 * em que todas as redações citadas valem ao mesmo tempo (todas contêm a data de referência).
 */
export function answerValidity(citations: readonly Citation[]): ValidityInterval | null {
  let window: ValidityInterval | null = null
  for (const citation of citations) {
    if (!citation.valid) continue
    window = window === null ? citation.validity : intersect(window, citation.validity)
    if (window === null) return null
  }
  return window
}

// ---------------------------------------------------------------------------------------------
// Partes e chunks a partir das respostas síncronas e do histórico

function referencePart(resolved: ResolvedReferenceDate): DataPart {
  return { type: 'data-reference-date', data: resolved }
}

/** Partes de uma resposta completa (cache hit ou histórico). */
export function answerParts(resolved: ResolvedReferenceDate, answer: Answer): TekoMessagePart[] {
  return [
    referencePart(resolved),
    { type: 'data-meta', data: answer.meta },
    ...answer.citations.map(
      (citation): DataPart => ({ type: 'data-citation', id: citation.id, data: citation }),
    ),
    { type: 'text', text: answer.markdown, state: 'done' },
  ]
}

export function refusalParts(resolved: ResolvedReferenceDate, refusal: Refusal): TekoMessagePart[] {
  return [referencePart(resolved), { type: 'data-refusal', data: refusal }]
}

export function clarificationParts(clarification: Clarification): TekoMessagePart[] {
  return [{ type: 'data-clarification', data: clarification }]
}

const SYNTHETIC_TEXT_ID = 'text-0'

/**
 * Chunks do UI Message Stream equivalentes às partes, para o transporte entregar uma resposta
 * síncrona pelo mesmo caminho do stream: `start` → data parts → texto → `finish`.
 */
export function partsToChunks(
  parts: readonly TekoMessagePart[],
  messageId?: string,
): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [
    messageId === undefined ? { type: 'start' } : { type: 'start', messageId },
  ]
  for (const part of parts) {
    if (part.type === 'text') {
      chunks.push(
        { type: 'text-start', id: SYNTHETIC_TEXT_ID },
        { type: 'text-delta', id: SYNTHETIC_TEXT_ID, delta: part.text },
        { type: 'text-end', id: SYNTHETIC_TEXT_ID },
      )
    } else if (part.type.startsWith('data-')) {
      const data = part as DataPart
      chunks.push(
        data.id === undefined
          ? { type: data.type, data: data.data }
          : { type: data.type, id: data.id, data: data.data },
      )
    }
  }
  chunks.push({ type: 'finish' })
  return chunks
}

/**
 * Pergunta do histórico como mensagens do chat: a do usuário e, se houver resposta ou recusa
 * gravada, a do assistente (com o `id` da pergunta, como no stream). Pergunta sem desfecho
 * (interrompida, expirada) fica só com a mensagem do usuário.
 */
export function questionDetailMessages(detail: QuestionDetail): TekoUIMessage[] {
  const user: TekoUIMessage = {
    id: `${detail.id}:question`,
    role: 'user',
    parts: [{ type: 'text', text: detail.question }],
  }
  const resolved: ResolvedReferenceDate = {
    value: detail.referenceDate,
    source: detail.referenceSource,
    periodBoundaryInside: false,
    alternatives: [],
  }
  if (detail.answer !== null) {
    return [user, { id: detail.id, role: 'assistant', parts: answerParts(resolved, detail.answer) }]
  }
  if (detail.refusal !== null) {
    return [
      user,
      { id: detail.id, role: 'assistant', parts: refusalParts(resolved, detail.refusal) },
    ]
  }
  return [user]
}
