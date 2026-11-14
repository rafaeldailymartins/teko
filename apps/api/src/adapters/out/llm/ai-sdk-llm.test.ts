import { describe, expect, it } from 'vitest'
import { LlmError, type LlmEvent, type LlmModel } from '#app/ports/llm-port.ts'
import {
  createLlmChain,
  GEMINI_BASE_URL,
  GROQ_BASE_URL,
  pinnedFetch,
  retryAfterMs,
  toLlmError,
} from './ai-sdk-llm.ts'

/** Chaves de teste montadas em runtime: nenhum literal com cara de chave (gitleaks). */
const GEMINI_KEY = 'g'.repeat(16)
const GROQ_KEY = 'q'.repeat(16)

const REQUEST = {
  system: 'sistema',
  prompt: 'pergunta',
  temperature: 0.1,
  maxOutputTokens: 100,
  signal: new AbortController().signal,
}

function sse(events: readonly unknown[], done = false): Response {
  const body = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}${done ? 'data: [DONE]\n\n' : ''}`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const GEMINI_STREAM = [
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Vale ' }] }, index: 0 }] },
  {
    candidates: [
      { content: { role: 'model', parts: [{ text: '[S1].' }] }, finishReason: 'STOP', index: 0 },
    ],
    usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 4, totalTokenCount: 46 },
  },
]

const GROQ_STREAM = [
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'openai/gpt-oss-120b',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'Olá' }, finish_reason: null }],
  },
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'openai/gpt-oss-120b',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    x_groq: { usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 } },
  },
]

interface Call {
  readonly url: string
  readonly headers: Headers
  readonly body: unknown
}

function chainWith(respond: (url: string) => Response): { chain: LlmModel[]; calls: Call[] } {
  const calls: Call[] = []
  const chain = createLlmChain({
    geminiApiKey: GEMINI_KEY,
    groqApiKey: GROQ_KEY,
    geminiModels: ['gemini-a', 'gemini-b'],
    groqModel: 'openai/gpt-oss-120b',
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({
        url,
        headers: new Headers(init?.headers),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      return respond(url)
    },
  })
  return { chain, calls }
}

async function collect(model: LlmModel): Promise<LlmEvent[]> {
  const events: LlmEvent[] = []
  for await (const event of model.stream(REQUEST)) {
    events.push(event)
  }
  return events
}

describe('createLlmChain', () => {
  it('monta Gemini, Gemini e Groq, só o Groq com ZDR', () => {
    const { chain } = chainWith(() => new Response(null, { status: 500 }))
    expect(chain.map((model) => [model.provider, model.model, model.zeroDataRetention])).toEqual([
      ['gemini', 'gemini-a', false],
      ['gemini', 'gemini-b', false],
      ['groq', 'openai/gpt-oss-120b', true],
    ])
  })

  it('Gemini: stream no host fixo, com a chave no header e sem retry', async () => {
    const { chain, calls } = chainWith(() => sse(GEMINI_STREAM))
    const events = await collect(chain[0] as LlmModel)
    expect(events).toEqual([
      { type: 'text', text: 'Vale ' },
      { type: 'text', text: '[S1].' },
      { type: 'finish', usage: { inputTokens: 42, outputTokens: 4 } },
    ])
    expect(calls).toHaveLength(1)
    expect(
      calls[0]?.url.startsWith(`${GEMINI_BASE_URL}/models/gemini-a:streamGenerateContent`),
    ).toBe(true)
    expect(calls[0]?.headers.get('x-goog-api-key')).toBe(GEMINI_KEY)
  })

  it('Groq: stream compatível com OpenAI no host fixo', async () => {
    const { chain, calls } = chainWith(() => sse(GROQ_STREAM, true))
    const events = await collect(chain[2] as LlmModel)
    expect(events[0]).toEqual({ type: 'text', text: 'Olá' })
    expect(events.at(-1)?.type).toBe('finish')
    expect(calls[0]?.url).toBe(`${GROQ_BASE_URL}/chat/completions`)
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${GROQ_KEY}`)
  })

  it.each([
    [429, { 'retry-after': '30' }, 'rate_limited', 30_000],
    [503, {}, 'unavailable', null],
    [401, {}, 'rejected', null],
  ] as const)('HTTP %i → LlmError %s', async (status, headers, kind, retryAfter) => {
    const { chain } = chainWith(
      () =>
        new Response(JSON.stringify({ error: { code: status, message: 'x', status: 'X' } }), {
          status,
          headers: { 'content-type': 'application/json', ...headers },
        }),
    )
    const failure = await collect(chain[0] as LlmModel).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LlmError)
    expect(failure).toMatchObject({ kind, retryAfterMs: retryAfter })
  })
})

describe('pinnedFetch', () => {
  it('só deixa passar a origem do provedor', async () => {
    const fetchInner = async () => new Response('ok')
    const pinned = pinnedFetch(GEMINI_BASE_URL, fetchInner)
    await expect(pinned(`${GEMINI_BASE_URL}/models/x`)).resolves.toBeInstanceOf(Response)
    await expect(
      pinned(new URL('https://generativelanguage.googleapis.com/x')),
    ).resolves.toBeInstanceOf(Response)
    await expect(pinned(new Request('https://evil.example/v1beta'))).rejects.toThrow(
      'origem https://evil.example recusada',
    )
  })
})

describe('retryAfterMs', () => {
  it('aceita segundos e data HTTP', () => {
    expect(retryAfterMs('2.5', 0)).toBe(2500)
    expect(retryAfterMs('Wed, 11 Nov 2026 08:00:10 GMT', Date.parse('2026-11-11T08:00:00Z'))).toBe(
      10_000,
    )
    expect(retryAfterMs('Wed, 11 Nov 2026 08:00:10 GMT', Date.parse('2026-11-12T00:00:00Z'))).toBe(
      0,
    )
    expect(retryAfterMs(undefined, 0)).toBeNull()
    expect(retryAfterMs(' ', 0)).toBeNull()
    expect(retryAfterMs('amanhã', 0)).toBeNull()
  })
})

describe('toLlmError', () => {
  it('cancelamento passa intacto; erro de rede vira unavailable', () => {
    const controller = new AbortController()
    const reason = new Error('saiu')
    controller.abort(reason)
    expect(toLlmError(new Error('x'), controller.signal, 0)).toBe(reason)
    expect(
      toLlmError(new TypeError('fetch failed'), new AbortController().signal, 0),
    ).toMatchObject({
      kind: 'unavailable',
    })
  })
})
