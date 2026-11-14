import { describe, expect, it, vi } from 'vitest'
import { TranslatorUnavailableError } from '#app/ports/translator-port.ts'
import { createWorkersAiTranslatorAdapter, M2M100_MODEL } from './workers-ai-translator-adapter.ts'

const ACCOUNT = '0123456789abcdef0123456789abcdef'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function adapter(fetchImpl: typeof fetch) {
  return createWorkersAiTranslatorAdapter({ accountId: ACCOUNT, apiToken: 'tok', fetch: fetchImpl })
}

describe('createWorkersAiTranslatorAdapter', () => {
  it('envia { text, source_lang, target_lang } ao m2m100 e devolve a tradução sem espaços nas pontas', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        json({ success: true, result: { translated_text: ' Imposto de renda retido? ' } }),
      ),
    )
    const port = adapter(fetchImpl)
    expect(port.model).toBe(M2M100_MODEL)
    const signal = new AbortController().signal
    await expect(port.toPortuguese('Income tax withheld?', { signal })).resolves.toBe(
      'Imposto de renda retido?',
    )
    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(String(url)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run/@cf/meta/m2m100-1.2b`,
    )
    expect(init?.method).toBe('POST')
    expect(init?.signal).toBe(signal)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok')
    expect(JSON.parse(String(init?.body))).toEqual({
      text: 'Income tax withheld?',
      source_lang: 'en',
      target_lang: 'pt',
    })
  })

  it('rede, HTTP, esquema, success falso e tradução vazia viram TranslatorUnavailableError', async () => {
    const replies: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(json({ errors: [] }, 503)),
      () => Promise.resolve(new Response('não é json', { status: 200 })),
      () => Promise.resolve(json({ result: 'x' })),
      () => Promise.resolve(json({ success: false, result: { translated_text: 'x' } })),
      () => Promise.resolve(json({ success: true, result: null })),
      () => Promise.resolve(json({ success: true, result: { translated_text: '   ' } })),
    ]
    for (const reply of replies) {
      await expect(
        adapter(vi.fn<typeof fetch>(reply)).toPortuguese('question'),
      ).rejects.toBeInstanceOf(TranslatorUnavailableError)
    }
  })
})
