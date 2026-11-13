import { describe, expect, it, vi } from 'vitest'
import { RerankerUnavailableError } from '#app/ports/reranker-port.ts'
import {
  BGE_RERANKER_MODEL,
  createWorkersAiRerankerAdapter,
} from './workers-ai-reranker-adapter.ts'

const ACCOUNT = '0123456789abcdef0123456789abcdef'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function adapter(fetchImpl: typeof fetch) {
  return createWorkersAiRerankerAdapter({ accountId: ACCOUNT, apiToken: 'tok', fetch: fetchImpl })
}

describe('createWorkersAiRerankerAdapter', () => {
  it('envia { query, contexts } ao bge-reranker-base e devolve as notas na ordem dos textos', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        json({
          success: true,
          result: {
            response: [
              { id: 1, score: 0.9 },
              { id: 0, score: 0.2 },
            ],
          },
        }),
      ),
    )
    const port = adapter(fetchImpl)
    expect(port.model).toBe(BGE_RERANKER_MODEL)
    const signal = new AbortController().signal
    await expect(port.rerank('pergunta', ['a', 'b'], { signal })).resolves.toEqual([0.2, 0.9])
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-reranker-base`,
    )
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBe(signal)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'pergunta',
      contexts: [{ text: 'a' }, { text: 'b' }],
    })
  })

  it('lista vazia não chama o provedor', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(adapter(fetchImpl).rerank('q', [])).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rede, HTTP, esquema e nota faltando viram RerankerUnavailableError', async () => {
    const failing = (impl: () => Promise<Response>) =>
      adapter(vi.fn<typeof fetch>(impl)).rerank('q', ['a', 'b'])
    await expect(failing(() => Promise.reject(new Error('rede')))).rejects.toBeInstanceOf(
      RerankerUnavailableError,
    )
    await expect(failing(() => Promise.resolve(json({}, 503)))).rejects.toThrow(/HTTP 503/)
    await expect(failing(() => Promise.resolve(json({ success: false })))).rejects.toThrow(
      /resposta inesperada/,
    )
    await expect(
      failing(() =>
        Promise.resolve(
          json({
            success: true,
            result: {
              response: [
                { id: 0, score: 1 },
                { id: 7, score: 2 },
              ],
            },
          }),
        ),
      ),
    ).rejects.toThrow(/notas para 2 de 2 textos/)
  })

  it('corpo que não é JSON ou conexão encerrada na leitura vira RerankerUnavailableError', async () => {
    const html = adapter(() => Promise.resolve(new Response('<html>502</html>', { status: 200 })))
    const htmlError = await html.rerank('q', ['a']).catch((error: unknown) => error)
    expect(htmlError).toBeInstanceOf(RerankerUnavailableError)
    expect(htmlError).toMatchObject({ message: expect.stringMatching(/corpo ilegível/) })
    expect((htmlError as Error).cause).toBeInstanceOf(SyntaxError)
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"success":tr'))
        controller.error(new TypeError('terminated'))
      },
    })
    await expect(
      adapter(() => Promise.resolve(new Response(cut))).rerank('q', ['a']),
    ).rejects.toBeInstanceOf(RerankerUnavailableError)
  })
})
