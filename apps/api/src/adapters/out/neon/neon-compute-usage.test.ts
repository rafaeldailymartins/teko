import { describe, expect, it } from 'vitest'
import { createNeonComputeUsage, neonProjectUrl } from './neon-compute-usage.ts'

function fakeFetch(
  response: Response,
  seen: { url?: string; auth?: string | null } = {},
): typeof fetch {
  return (input, init) => {
    seen.url = String(input)
    seen.auth = new Headers(init?.headers).get('authorization')
    return Promise.resolve(response)
  }
}

describe('NeonComputeUsage', () => {
  it('lê compute_time_seconds do projeto pela API v2', async () => {
    const seen: { url?: string; auth?: string | null } = {}
    const meter = createNeonComputeUsage({
      apiKey: 'chave-teste',
      projectId: 'aged-wildflower-123456',
      fetch: fakeFetch(Response.json({ project: { compute_time_seconds: 1234.5, id: 'x' } }), seen),
    })
    expect(await meter.computeSeconds()).toBe(1234.5)
    expect(seen).toEqual({
      url: 'https://console.neon.tech/api/v2/projects/aged-wildflower-123456',
      auth: 'Bearer chave-teste',
    })
  })

  it('sem chave ou projeto, devolve null sem chamar a API', async () => {
    const throwing: typeof fetch = () => Promise.reject(new Error('não deveria chamar'))
    expect(
      await createNeonComputeUsage({
        apiKey: undefined,
        projectId: 'p',
        fetch: throwing,
      }).computeSeconds(),
    ).toBeNull()
    expect(
      await createNeonComputeUsage({
        apiKey: 'k',
        projectId: undefined,
        fetch: throwing,
      }).computeSeconds(),
    ).toBeNull()
  })

  it('HTTP de erro ou resposta inesperada viram null', async () => {
    const failing = createNeonComputeUsage({
      apiKey: 'k',
      projectId: 'p',
      fetch: fakeFetch(new Response('não', { status: 401 })),
    })
    expect(await failing.computeSeconds()).toBeNull()
    const odd = createNeonComputeUsage({
      apiKey: 'k',
      projectId: 'p',
      fetch: fakeFetch(Response.json({ project: {} })),
    })
    expect(await odd.computeSeconds()).toBeNull()
  })

  it('recusa ID de projeto que mudaria o caminho', () => {
    expect(() => neonProjectUrl('../../outra-coisa')).toThrow(RangeError)
    expect(() => createNeonComputeUsage({ apiKey: 'k', projectId: 'a/b' })).toThrow(RangeError)
  })
})
