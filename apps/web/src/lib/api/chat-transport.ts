import { type AskQuestionResponse, QuestionStatus } from '@teko/shared/contracts'
import type { Locale } from '@teko/shared/i18n'
import { isIsoDate } from '@teko/shared/vigencia'
import {
  type ChatRequestOptions,
  type ChatTransport,
  parseJsonEventStream,
  type UIMessageChunk,
  uiMessageChunkSchema,
} from 'ai'
import {
  answerParts,
  clarificationParts,
  messageText,
  partsToChunks,
  refusalParts,
  type TekoUIMessage,
} from '../chat/parts.ts'
import { clarifiedRequest, type ReferenceRequest } from '../chat/reference.ts'
import { askQuestion } from './__generated__/sdk.gen.ts'
import { apiClient } from './client.ts'
import { toApiError } from './errors.ts'
import { traceIdOf, withTraceparent } from './trace.ts'

/**
 * Transporte do `useChat` (ADR 0029, mesma origem):
 *
 * 1. `POST /api/v1/questions` pelo SDK gerado (o interceptor converte erro em `ApiError`);
 * 2. `answered` (cache), `refused` e `needs_clarification` voltam na hora e viram chunks
 *    sintetizados, pelo mesmo caminho do stream;
 * 3. `accepted` abre `POST /api/v1/questions/:id/stream` com `fetch` (cookie de sessão, sem CORS e
 *    com um `traceparent` novo, como o cliente gerado) e lê o UI Message Stream v1 com o parser e
 *    o schema do próprio `ai`. O `x-trace-id` da resposta fica em `lastTraceId`: um chunk `error`
 *    no meio do stream não traz o "ID de suporte", e a UI o lê daqui.
 *
 * Sem resume: `reconnectToStream` devolve `null`, e a UI relê `GET /questions/:id` quando o stream
 * cai.
 */

export interface ChatRequestContext {
  readonly locale: Locale
  readonly reference: ReferenceRequest
}

/**
 * Corpo extra de `sendMessage(..., { body: { clarifiedDate } })` para responder a um
 * `needs_clarification`: a data escolhida vai com `source: 'clarified'` e não é confrontada de novo
 * com o texto.
 */
function clarifiedOverride(body: object | undefined): ReferenceRequest | null {
  if (body === undefined || !('clarifiedDate' in body)) return null
  const date: unknown = body.clarifiedDate
  return isIsoDate(date) ? clarifiedRequest(date) : null
}

/** Texto da última mensagem do usuário (a pergunta a enviar). */
export function lastUserText(messages: readonly TekoUIMessage[]): string {
  const last = messages.findLast((message) => message.role === 'user')
  return last === undefined ? '' : messageText(last)
}

type SyncResponse = Exclude<AskQuestionResponse, { status: typeof QuestionStatus.Accepted }>

/** Chunks de uma resposta síncrona (cache hit, recusa ou pedido de esclarecimento). */
export function synthesizeChunks(response: SyncResponse): UIMessageChunk[] {
  switch (response.status) {
    case QuestionStatus.Answered:
      return partsToChunks(answerParts(response.resolved, response.answer), response.questionId)
    case QuestionStatus.Refused:
      return partsToChunks(refusalParts(response.resolved, response.refusal), response.questionId)
    case QuestionStatus.NeedsClarification:
      return partsToChunks(
        clarificationParts({ reason: response.reason, candidates: response.candidates }),
      )
  }
}

function chunkStream(chunks: readonly UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

type ParsedChunk =
  ReturnType<typeof parseJsonEventStream<UIMessageChunk>> extends ReadableStream<infer T>
    ? T
    : never

/** Desembrulha o `ParseResult`: chunk inválido derruba o stream (o `useChat` mostra o erro). */
function unwrapParsed(): TransformStream<ParsedChunk, UIMessageChunk> {
  return new TransformStream({
    transform(result, controller) {
      if (result.success) {
        controller.enqueue(result.value)
      } else {
        controller.error(result.error)
      }
    },
  })
}

async function readProblem(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

export interface TekoChatTransportOptions {
  /** Locale e data de referência no momento do envio (o chip pode mudar entre perguntas). */
  readonly context: () => ChatRequestContext
}

export class TekoChatTransport implements ChatTransport<TekoUIMessage> {
  readonly #options: TekoChatTransportOptions
  #lastTraceId: string | null = null

  constructor(options: TekoChatTransportOptions) {
    this.#options = options
  }

  /** `x-trace-id` do último stream aberto (`null` antes dele ou sem o header). */
  get lastTraceId(): string | null {
    return this.#lastTraceId
  }

  async sendMessages({
    chatId,
    messages,
    abortSignal,
    body,
  }: Parameters<ChatTransport<TekoUIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    this.#lastTraceId = null
    const { locale, reference } = this.#options.context()
    const signal = abortSignal === undefined ? {} : { signal: abortSignal }
    const { data } = await askQuestion({
      client: apiClient,
      throwOnError: true,
      ...signal,
      body: {
        conversationId: chatId,
        question: lastUserText(messages),
        locale,
        ...(clarifiedOverride(body) ?? reference),
      },
    })
    const response = data as AskQuestionResponse
    if (response.status !== QuestionStatus.Accepted) {
      return chunkStream(synthesizeChunks(response))
    }
    const baseUrl = apiClient.getConfig().baseUrl ?? '/api'
    const stream = await fetch(
      `${baseUrl}/v1/questions/${encodeURIComponent(response.questionId)}/stream`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: withTraceparent(new Headers({ 'content-type': 'application/json' })),
        body: '{}',
        ...signal,
      },
    )
    this.#lastTraceId = traceIdOf(stream)
    if (!stream.ok || stream.body === null) {
      throw toApiError(await readProblem(stream), stream)
    }
    return parseJsonEventStream({ stream: stream.body, schema: uiMessageChunkSchema }).pipeThrough(
      unwrapParsed(),
    )
  }

  async reconnectToStream(
    _options: { chatId: string; abortSignal?: AbortSignal } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }
}
