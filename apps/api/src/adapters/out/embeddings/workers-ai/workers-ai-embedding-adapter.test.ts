import { describe, expect, it, vi } from 'vitest'
import { EmbeddingUnavailableError } from '#app/ports/embedding-port.ts'
import {
  BGE_M3_DIMENSIONS,
  BGE_M3_MODEL,
  createWorkersAiEmbeddingAdapter,
  workersAiEndpoint,
} from './workers-ai-embedding-adapter.ts'

const ACCOUNT = '0123456789abcdef0123456789abcdef'
const vector = (value: number) => Array.from({ length: BGE_M3_DIMENSIONS }, () => value)

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(init.status === undefined ? {} : { status: init.status }),
  })
}

function adapter(fetchImpl: typeof fetch, onUsage = vi.fn()) {
  return {
    port: createWorkersAiEmbeddingAdapter({
      accountId: ACCOUNT,
      apiToken: 'tok',
      fetch: fetchImpl,
      onUsage,
    }),
    onUsage,
  }
}

describe('workersAiEndpoint', () => {
  it('monta a URL fixa do BGE-M3 e valida a conta', () => {
    expect(workersAiEndpoint(ACCOUNT).href).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/baai/bge-m3`,
    )
    expect(() => workersAiEndpoint('../evil')).toThrow(/CF_ACCOUNT_ID inválido/)
  })
})

describe('createWorkersAiEmbeddingAdapter', () => {
  it('envia { text } com o token e devolve os vetores, reportando o custo do corpo', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        json({
          success: true,
          result: {
            shape: [2, BGE_M3_DIMENSIONS],
            data: [vector(0.1), vector(0.2)],
            meta: { neurons: 1.5 },
          },
        }),
      ),
    )
    const { port, onUsage } = adapter(fetchImpl)
    expect(port.model).toBe(BGE_M3_MODEL)
    const signal = new AbortController().signal
    await expect(port.embed(['a', 'b'], { signal })).resolves.toEqual([vector(0.1), vector(0.2)])
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toContain('/ai/run/@cf/baai/bge-m3')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: JSON.stringify({ text: ['a', 'b'] }),
      signal,
    })
    expect(onUsage).toHaveBeenCalledWith({ neurons: 1.5, texts: 2 })
  })

  it('sem custo no corpo usa o header cf-ai-neurons, ou null', async () => {
    const ok = { success: true, result: { shape: [1, BGE_M3_DIMENSIONS], data: [vector(0)] } }
    const header = adapter(() =>
      Promise.resolve(json(ok, { headers: { 'cf-ai-neurons': '2.25' } })),
    )
    await header.port.embed(['a'])
    expect(header.onUsage).toHaveBeenCalledWith({ neurons: 2.25, texts: 1 })
    const none = adapter(() => Promise.resolve(json(ok, { headers: { 'cf-ai-neurons': 'x' } })))
    await none.port.embed(['a'])
    expect(none.onUsage).toHaveBeenCalledWith({ neurons: null, texts: 1 })
    const absent = adapter(() => Promise.resolve(json(ok)))
    await absent.port.embed(['a'])
    expect(absent.onUsage).toHaveBeenCalledWith({ neurons: null, texts: 1 })
  })

  it('lista vazia não chama a API', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(adapter(fetchImpl).port.embed([])).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['falha de rede', () => Promise.reject(new TypeError('fetch failed'))],
    ['HTTP 400', () => Promise.resolve(json({ success: false }, { status: 400 }))],
    [
      'success false',
      () => Promise.resolve(json({ success: false, result: null, errors: [{ message: 'x' }] })),
    ],
    [
      'corpo fora do formato',
      () => Promise.resolve(json({ success: true, result: { data: 'x' } })),
    ],
    [
      'shape diferente do pedido',
      () =>
        Promise.resolve(json({ success: true, result: { shape: [1, 768], data: [vector(0)] } })),
    ],
    [
      'número de vetores diferente',
      () =>
        Promise.resolve(
          json({
            success: true,
            result: { shape: [1, BGE_M3_DIMENSIONS], data: [vector(0), vector(1)] },
          }),
        ),
    ],
  ])('%s vira EmbeddingUnavailableError', async (_name, fetchImpl) => {
    await expect(adapter(fetchImpl as typeof fetch).port.embed(['a'])).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    )
  })

  it('usa o fetch global por padrão', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        json({ success: true, result: { shape: [1, BGE_M3_DIMENSIONS], data: [vector(0)] } }),
      )
    try {
      const port = createWorkersAiEmbeddingAdapter({ accountId: ACCOUNT, apiToken: 't' })
      await expect(port.embed(['a'])).resolves.toHaveLength(1)
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })
})
