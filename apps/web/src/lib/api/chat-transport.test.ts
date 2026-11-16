import { createStreamErrorChunk, encodeSseChunk, SSE_DONE } from '@teko/shared/contracts'
import { createProblem, ErrorCode } from '@teko/shared/errors'
import type { UIMessageChunk } from 'ai'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ANSWER, QUESTION_ID, RESOLVED_2008 } from '../../../test/chat-fixtures.ts'
import type { TekoUIMessage } from '../chat/parts.ts'
import { lastUserText, synthesizeChunks, TekoChatTransport } from './chat-transport.ts'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'

/**
 * Transporte do chat sem rede: `fetch` simulado responde o `POST /questions` (pelo SDK gerado) e o
 * stream (UI Message Stream v1 em SSE, como o writer da API emite).
 */

const ORIGIN = 'http://teko.test'
const CHAT_ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a00'

interface Call {
  readonly url: string
  readonly method: string
  readonly body: string
  readonly credentials: RequestCredentials | undefined
  readonly signal: AbortSignal | null | undefined
  readonly traceparent: string | null
}

const calls: Call[] = []

type Handler = (call: Call) => Response | Promise<Response>

function mockFetch(handler: Handler): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const call: Call = {
        url: request.url,
        method: request.method,
        body: await request.clone().text(),
        credentials: init?.credentials,
        signal: init?.signal ?? request.signal,
        traceparent: request.headers.get('traceparent'),
      }
      calls.push(call)
      return handler(call)
    }),
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  })
}

function sse(lines: readonly string[]): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const userMessage = (text: string): TekoUIMessage => ({
  id: `u-${text}`,
  role: 'user',
  parts: [{ type: 'text', text }],
})

function transport(): TekoChatTransport {
  return new TekoChatTransport({
    context: () => ({
      locale: 'pt-BR',
      reference: { periodoApuracao: '2008-05', source: 'periodo_apuracao' },
    }),
  })
}

function send(
  target: TekoChatTransport,
  options: { body?: object; abortSignal?: AbortSignal } = {},
): Promise<ReadableStream<UIMessageChunk>> {
  return target.sendMessages({
    trigger: 'submit-message',
    chatId: CHAT_ID,
    messageId: undefined,
    messages: [userMessage('primeira'), userMessage('O que diz o art. 76, § 6º do RCTE?')],
    abortSignal: options.abortSignal,
    ...(options.body === undefined ? {} : { body: options.body }),
  })
}

let defaultBaseUrl: string | undefined

beforeAll(() => {
  defaultBaseUrl = apiClient.getConfig().baseUrl
  apiClient.setConfig({ baseUrl: `${ORIGIN}/api` })
})

afterEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
})

afterAll(() => {
  apiClient.setConfig({ baseUrl: defaultBaseUrl ?? '/api' })
})

describe('TekoChatTransport.sendMessages', () => {
  it('manda a última pergunta, o locale e a data do chip no POST /questions', async () => {
    mockFetch(() =>
      json({
        status: 'refused',
        questionId: QUESTION_ID,
        resolved: RESOLVED_2008,
        refusal: { reason: 'no_evidence' },
      }),
    )
    await collect(await send(transport()))
    expect(calls[0]?.url).toBe(`${ORIGIN}/api/v1/questions`)
    expect(calls[0]?.method).toBe('POST')
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      conversationId: CHAT_ID,
      question: 'O que diz o art. 76, § 6º do RCTE?',
      locale: 'pt-BR',
      periodoApuracao: '2008-05',
      source: 'periodo_apuracao',
    })
  })

  it('answered (cache) vira chunks sintetizados, com o id da pergunta', async () => {
    mockFetch(() =>
      json({
        status: 'answered',
        questionId: QUESTION_ID,
        resolved: RESOLVED_2008,
        answer: ANSWER,
      }),
    )
    const chunks = await collect(await send(transport()))
    expect(calls).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'start', messageId: QUESTION_ID })
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'start',
      'data-reference-date',
      'data-meta',
      'data-citation',
      'data-citation',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    expect(chunks).toContainEqual({ type: 'data-citation', id: 'S1', data: ANSWER.citations[0] })
  })

  it('refused vira data-reference-date e data-refusal', async () => {
    mockFetch(() =>
      json({
        status: 'refused',
        questionId: QUESTION_ID,
        resolved: RESOLVED_2008,
        refusal: { reason: 'out_of_coverage', coverage: [] },
      }),
    )
    const chunks = await collect(await send(transport()))
    expect(chunks).toContainEqual({
      type: 'data-refusal',
      data: { reason: 'out_of_coverage', coverage: [] },
    })
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })

  it('needs_clarification vira data-clarification com as candidatas', async () => {
    mockFetch(() =>
      json({
        status: 'needs_clarification',
        reason: 'explicit_conflict',
        candidates: ['2008-05-01', '2010-01-01'],
      }),
    )
    const chunks = await collect(await send(transport()))
    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'data-clarification',
        data: { reason: 'explicit_conflict', candidates: ['2008-05-01', '2010-01-01'] },
      },
      { type: 'finish' },
    ])
  })

  it('a escolha do esclarecimento vai como clarified, no lugar da data do chip', async () => {
    mockFetch(() =>
      json({
        status: 'refused',
        questionId: QUESTION_ID,
        resolved: RESOLVED_2008,
        refusal: { reason: 'no_evidence' },
      }),
    )
    await collect(await send(transport(), { body: { clarifiedDate: '2010-01-01' } }))
    const body = JSON.parse(calls[0]?.body ?? '') as Record<string, unknown>
    expect(body['referenceDate']).toBe('2010-01-01')
    expect(body['source']).toBe('clarified')
    expect(body['periodoApuracao']).toBeUndefined()
  })

  it('ignora corpo extra que não seja uma data válida', async () => {
    mockFetch(() =>
      json({
        status: 'refused',
        questionId: QUESTION_ID,
        resolved: RESOLVED_2008,
        refusal: { reason: 'no_evidence' },
      }),
    )
    await collect(await send(transport(), { body: { clarifiedDate: 'ontem' } }))
    expect(JSON.parse(calls[0]?.body ?? '')).toMatchObject({ source: 'periodo_apuracao' })
  })

  it('accepted abre o stream na mesma origem, com cookie, e entrega os chunks do SSE', async () => {
    mockFetch((call) => {
      if (call.url.endsWith('/v1/questions')) {
        return json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
      }
      return sse([
        ': hb\n\n',
        encodeSseChunk({ type: 'start', messageId: QUESTION_ID }),
        encodeSseChunk({ type: 'data-reference-date', data: RESOLVED_2008 }),
        encodeSseChunk({ type: 'text-start', id: 't' }),
        encodeSseChunk({ type: 'text-delta', id: 't', delta: 'Conforme ' }),
        encodeSseChunk({ type: 'text-delta', id: 't', delta: '[S1](cite:S1).' }),
        encodeSseChunk({ type: 'text-end', id: 't' }),
        encodeSseChunk({
          type: 'finish',
          messageMetadata: {
            usage: { inputTokens: 10, outputTokens: 3 },
            model: 'fake-llm-1',
            traceId: 'abc',
          },
        }),
        SSE_DONE,
      ])
    })
    const chunks = await collect(await send(transport()))
    expect(calls[1]?.url).toBe(`${ORIGIN}/api/v1/questions/${QUESTION_ID}/stream`)
    expect(calls[1]?.method).toBe('POST')
    expect(calls[1]?.credentials).toBe('same-origin')
    expect(calls[1]?.body).toBe('{}')
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      'start',
      'data-reference-date',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ])
  })

  it('cada requisição leva um traceparent novo; o x-trace-id do stream fica no transporte', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    mockFetch((call) => {
      if (call.url.endsWith('/v1/questions')) {
        return json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
      }
      const response = sse([
        encodeSseChunk({ type: 'start', messageId: QUESTION_ID }),
        encodeSseChunk(createStreamErrorChunk(ErrorCode.UpstreamUnavailable)),
      ])
      response.headers.set('x-trace-id', traceId)
      return response
    })
    const chat = transport()
    expect(chat.lastTraceId).toBeNull()
    await collect(await send(chat))
    const traceparents = calls.map((call) => call.traceparent)
    expect(traceparents).toEqual([
      expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/),
      expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/),
    ])
    expect(traceparents[0]).not.toBe(traceparents[1])
    expect(chat.lastTraceId).toBe(traceId)
  })

  it('o chunk error do stream chega ao useChat com {code, retryable}', async () => {
    mockFetch((call) =>
      call.url.endsWith('/v1/questions')
        ? json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
        : sse([
            encodeSseChunk({ type: 'start', messageId: QUESTION_ID }),
            encodeSseChunk(createStreamErrorChunk(ErrorCode.UpstreamUnavailable)),
          ]),
    )
    const chunks = await collect(await send(transport()))
    expect(chunks.at(-1)).toEqual({
      type: 'error',
      errorText: JSON.stringify({ code: 'upstream_unavailable', retryable: true }),
    })
  })

  it('stream recusado (409 stream_busy) vira ApiError repetível', async () => {
    mockFetch((call) =>
      call.url.endsWith('/v1/questions')
        ? json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
        : json(createProblem({ code: ErrorCode.StreamBusy, traceId: 'trace-1' }), 409),
    )
    const error = await send(transport()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'stream_busy', retryable: true, traceId: 'trace-1' })
  })

  it('stream sem corpo de problema usa o status HTTP', async () => {
    mockFetch((call) =>
      call.url.endsWith('/v1/questions')
        ? json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
        : new Response('<html>502</html>', { status: 502 }),
    )
    await expect(send(transport())).rejects.toMatchObject({ code: 'internal', status: 502 })
  })

  it('cota estourada no POST /questions vira ApiError com o reset', async () => {
    mockFetch(() =>
      json(
        createProblem({
          code: ErrorCode.QuotaExceeded,
          traceId: 'trace-2',
          meta: { scope: 'user_daily', resetAt: '2026-11-16T03:00:00.000Z' },
        }),
        429,
      ),
    )
    await expect(send(transport())).rejects.toMatchObject({
      code: 'quota_exceeded',
      quota: { resetAt: '2026-11-16T03:00:00.000Z' },
    })
  })

  it('chunk inválido no SSE derruba o stream', async () => {
    mockFetch((call) =>
      call.url.endsWith('/v1/questions')
        ? json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
        : sse(['data: {"type":"nao-existe"}\n\n']),
    )
    await expect(collect(await send(transport()))).rejects.toBeDefined()
  })

  it('repassa o abortSignal às duas requisições, e o abort interrompe', async () => {
    const controller = new AbortController()
    mockFetch((call) => {
      if (call.url.endsWith('/v1/questions')) {
        return json({ status: 'accepted', questionId: QUESTION_ID, resolved: RESOLVED_2008 })
      }
      controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    await expect(send(transport(), { abortSignal: controller.signal })).rejects.toBeDefined()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.signal).toBe(controller.signal)
    expect(controller.signal.aborted).toBe(true)
  })
})

describe('TekoChatTransport.reconnectToStream', () => {
  it('não há resume: devolve null (a UI relê GET /questions/:id)', async () => {
    await expect(transport().reconnectToStream({ chatId: CHAT_ID })).resolves.toBeNull()
  })
})

describe('auxiliares', () => {
  it('lastUserText pega a última mensagem do usuário', () => {
    const assistant: TekoUIMessage = {
      id: 'a',
      role: 'assistant',
      parts: [{ type: 'text', text: 'resposta' }],
    }
    expect(lastUserText([userMessage('a'), userMessage('b'), assistant])).toBe('b')
    expect(lastUserText([assistant])).toBe('')
  })

  it('synthesizeChunks não gera id para o esclarecimento', () => {
    const chunks = synthesizeChunks({
      status: 'needs_clarification',
      reason: 'ambiguous_text',
      candidates: ['2004-03-01', '2006-05-01'],
    })
    expect(chunks[0]).toEqual({ type: 'start' })
  })
})
