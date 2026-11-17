// @vitest-environment happy-dom
import { cpfCheckDigits } from '@teko/shared/pii'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POSTHOG_API_HOST } from './posthog-hosts.ts'

/**
 * O cliente de erros com o `posthog-js` de verdade (só o `fetch` é falso): o `$exception` sai à UE
 * com o `trace_id` e o release, sem PII e sem gravar nada no navegador. O SDK descarta eventos de
 * robôs (`navigator.webdriver` e user agents como o do happy-dom), então o teste se apresenta como
 * um Chrome comum.
 */

const KEY = 'phc_chave_publica_de_teste'
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const CPF = `529982247${cpfCheckDigits('529982247')}`
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('cliente de erros com o posthog-js de verdade', () => {
  it('manda o $exception à UE, sem PII e sem storage', async () => {
    Object.defineProperty(window.navigator, 'userAgent', { value: CHROME_UA, configurable: true })
    Object.defineProperty(window.navigator, 'webdriver', { value: false, configurable: true })
    const sent: { url: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const body = init?.body
        sent.push({
          url: String(url),
          body: body instanceof Blob ? await body.text() : String(body ?? ''),
        })
        return new Response('{}', { status: 200 })
      }),
    )
    const { loadErrorClient } = await import('./error-client.ts')
    loadErrorClient(KEY).capture(new Error(`falhou com o CPF ${CPF}`), {
      trace_id: TRACE_ID,
      release: 'teko@abc1234',
    })

    await vi.waitFor(() => expect(sent.some((r) => r.body.includes('$exception'))).toBe(true), {
      timeout: 15_000,
    })
    const exception = sent.find((r) => r.body.includes('$exception'))
    expect(exception?.url.startsWith(`${POSTHOG_API_HOST}/`)).toBe(true)
    expect(exception?.body).toContain(TRACE_ID)
    expect(exception?.body).toContain('teko@abc1234')
    expect(exception?.body).toContain('[CPF]')
    expect(exception?.body).not.toContain(CPF)
    for (const request of sent) {
      expect(request.url.startsWith(`${POSTHOG_API_HOST}/`), request.url).toBe(true)
    }
    expect(Object.keys(localStorage)).toEqual([])
    expect(sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  }, 30_000)
})
