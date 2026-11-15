import { vi } from 'vitest'

/**
 * API falsa dos testes de componente: cada rota (`MÉTODO /caminho`) responde o que o teste
 * definir, e tudo o que não foi definido é 404. As chamadas ficam registradas com o corpo.
 */
export interface ApiCall {
  readonly route: string
  readonly body: unknown
}

type Handler = (call: ApiCall) => Response

export interface FakeApi {
  readonly calls: ApiCall[]
  on(route: string, handler: Handler | unknown): void
}

export const ME = {
  id: '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b',
  name: 'Ana Souza',
  email: 'ana@teko.localhost',
  image: null,
  onboarding: {
    required: false,
    currentTermsVersion: '2026-11-14',
    acceptedTermsVersion: '2026-11-14',
    countryOfResidence: 'BR',
  },
} as const

export function problem(status: number, code: string): Response {
  return Response.json(
    { type: 'about:blank', title: code, status, code, traceId: 'trace-teste' },
    { status, headers: { 'content-type': 'application/problem+json' } },
  )
}

/** Instala o `fetch` falso (desfeito por `vi.unstubAllGlobals()`). */
export function installFakeApi(): FakeApi {
  const calls: ApiCall[] = []
  const handlers = new Map<string, Handler>()
  vi.stubGlobal('fetch', async (input: Request) => {
    const url = new URL(input.url)
    const text = await input.text()
    const call = {
      route: `${input.method} ${url.pathname}`,
      body: text === '' ? undefined : (JSON.parse(text) as unknown),
    }
    calls.push(call)
    const handler = handlers.get(call.route)
    return handler === undefined ? problem(404, 'not_found') : handler(call)
  })
  return {
    calls,
    on(route, handler) {
      handlers.set(
        route,
        typeof handler === 'function' ? (handler as Handler) : () => Response.json(handler),
      )
    },
  }
}
