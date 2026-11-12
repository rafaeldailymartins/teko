import { describe, expect, it, vi } from 'vitest'
import { BlockedRequestError } from '#app/ports/safe-fetcher.ts'
import {
  CORPUS_USER_AGENT,
  createSafeFetcher,
  createSafeLookup,
  normalizeHeaders,
  type ResolvedAddress,
  type Resolver,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './safe-fetcher.ts'

const HOST = 'www.gov.br'
const PUBLIC: readonly ResolvedAddress[] = [{ address: '161.148.164.31', family: 4 }]

function ok(body = 'conteúdo', headers: Record<string, string> = {}): TransportResponse {
  return { status: 200, headers, body: new TextEncoder().encode(body) }
}

function setup(options: {
  responses?: TransportResponse[]
  resolver?: Resolver
  allowedHosts?: string[]
}) {
  const calls: TransportRequest[] = []
  const queue = [...(options.responses ?? [ok()])]
  const transport: Transport = (request) => {
    calls.push(request)
    const next = queue.shift()
    return next === undefined ? Promise.reject(new Error('sem resposta')) : Promise.resolve(next)
  }
  let clock = 0
  const sleeps: number[] = []
  const fetcher = createSafeFetcher({
    allowedHosts: options.allowedHosts ?? [HOST, 'appasp.economia.go.gov.br'],
    resolver: options.resolver ?? (() => Promise.resolve(PUBLIC)),
    transport,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms)
      clock += ms
      return Promise.resolve()
    },
  })
  return {
    fetcher,
    calls,
    sleeps,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

describe('createSafeFetcher: URL', () => {
  it.each([
    ['http://www.gov.br/x', /só https/],
    ['https://user:senha@www.gov.br/x', /credenciais/],
    ['https://www.gov.br:8443/x', /porta 8443/],
    ['https://evil.example/x', /allowlist/],
    ['https://www.gov.br.evil.example/x', /allowlist/],
    ['nada', /URL inválida/],
  ])('recusa %s', async (url, message) => {
    const { fetcher, calls } = setup({})
    await expect(fetcher.fetch({ url })).rejects.toThrow(message)
    expect(calls).toHaveLength(0)
  })

  it('aceita a porta 443 explícita e devolve status, URL final, cabeçalhos e corpo', async () => {
    const { fetcher, calls } = setup({ responses: [ok('pdf', { etag: '"1"' })] })
    const response = await fetcher.fetch({ url: 'https://www.gov.br:443/sped/a.pdf' })
    expect(response).toEqual({
      status: 200,
      url: 'https://www.gov.br/sped/a.pdf',
      headers: { etag: '"1"' },
      body: new TextEncoder().encode('pdf'),
    })
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers['user-agent']).toBe(CORPUS_USER_AGENT)
    expect(calls[0]?.headers['accept-encoding']).toBe('identity')
  })
})

describe('createSafeFetcher: DNS', () => {
  it('recusa host que resolve para endereço privado, metadata ou IPv4 mapeado', async () => {
    for (const address of ['10.0.0.5', '169.254.169.254', '::ffff:127.0.0.1', 'fd00:ec2::254']) {
      const { fetcher, calls } = setup({
        resolver: () =>
          Promise.resolve([...PUBLIC, { address, family: address.includes(':') ? 6 : 4 }]),
      })
      await expect(fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toBeInstanceOf(
        BlockedRequestError,
      )
      expect(calls).toHaveLength(0)
    }
  })

  it('recusa host sem endereço', async () => {
    const { fetcher } = setup({ resolver: () => Promise.resolve([]) })
    await expect(fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toThrow(/nenhum endereço/)
  })
})

describe('createSafeFetcher: redirects', () => {
  it('segue até 3 redirects revalidando cada destino', async () => {
    const redirect = (location: string): TransportResponse => ({
      status: 302,
      headers: { location },
      body: new Uint8Array(),
    })
    const { fetcher, calls } = setup({
      responses: [
        redirect('/b'),
        redirect('https://appasp.economia.go.gov.br/c'),
        redirect('/d'),
        ok('fim'),
      ],
    })
    const response = await fetcher.fetch({ url: 'https://www.gov.br/a' })
    expect(response.url).toBe('https://appasp.economia.go.gov.br/d')
    expect(calls.map((call) => call.url.toString())).toEqual([
      'https://www.gov.br/a',
      'https://www.gov.br/b',
      'https://appasp.economia.go.gov.br/c',
      'https://appasp.economia.go.gov.br/d',
    ])
  })

  it('recusa o quarto redirect e o redirect para fora da allowlist ou para http', async () => {
    const loop: TransportResponse = {
      status: 301,
      headers: { location: '/x' },
      body: new Uint8Array(),
    }
    const many = setup({ responses: [loop, loop, loop, loop] })
    await expect(many.fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toThrow(/mais de 3/)

    const outside = setup({
      responses: [
        { status: 307, headers: { location: 'https://169.254.169.254/' }, body: new Uint8Array() },
      ],
    })
    await expect(outside.fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toThrow(/allowlist/)

    const plain = setup({
      responses: [
        { status: 308, headers: { location: 'http://www.gov.br/' }, body: new Uint8Array() },
      ],
    })
    await expect(plain.fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toThrow(/só https/)
  })

  it('devolve 3xx sem location como resposta (ex.: 304 do GET condicional)', async () => {
    const { fetcher } = setup({ responses: [{ status: 304, headers: {}, body: new Uint8Array() }] })
    const response = await fetcher.fetch({
      url: 'https://www.gov.br/',
      headers: { 'If-None-Match': '"1"' },
    })
    expect(response.status).toBe(304)
  })
})

describe('createSafeFetcher: cabeçalhos, ritmo e teto', () => {
  it('recusa cabeçalho reservado e repassa os condicionais em minúsculas', async () => {
    const { fetcher, calls } = setup({})
    await expect(
      fetcher.fetch({ url: 'https://www.gov.br/', headers: { 'User-Agent': 'outro' } }),
    ).rejects.toThrow(/reservado/)
    await fetcher.fetch({
      url: 'https://www.gov.br/',
      method: 'HEAD',
      headers: { 'If-Modified-Since': 'x' },
    })
    expect(calls[0]?.headers['if-modified-since']).toBe('x')
    expect(calls[0]?.method).toBe('HEAD')
  })

  it('espaça as requisições do mesmo host em 1 s, sem atrasar outro host', async () => {
    const { fetcher, sleeps, advance } = setup({ responses: [ok(), ok(), ok(), ok()] })
    await fetcher.fetch({ url: 'https://www.gov.br/1' })
    await fetcher.fetch({ url: 'https://www.gov.br/2' })
    await fetcher.fetch({ url: 'https://appasp.economia.go.gov.br/3' })
    expect(sleeps).toEqual([1000])
    advance(5000)
    await fetcher.fetch({ url: 'https://www.gov.br/4' })
    expect(sleeps).toEqual([1000])
  })

  it('recusa corpo acima do teto', async () => {
    const { fetcher } = setup({ responses: [ok('0123456789')] })
    await expect(fetcher.fetch({ url: 'https://www.gov.br/', maxBytes: 5 })).rejects.toThrow(/teto/)
  })

  it('repassa o maxBytes e um sinal de cancelamento ao transporte', async () => {
    const { fetcher, calls } = setup({})
    const controller = new AbortController()
    await fetcher.fetch({ url: 'https://www.gov.br/', maxBytes: 99, signal: controller.signal })
    expect(calls[0]?.maxBytes).toBe(99)
    expect(calls[0]?.signal.aborted).toBe(false)
    controller.abort()
    expect(calls[0]?.signal.aborted).toBe(true)
  })
})

describe('createSafeLookup', () => {
  function run(resolver: Resolver, all: boolean) {
    const lookup = createSafeLookup(resolver)
    return new Promise<{ error: Error | null; result: unknown }>((resolve) => {
      lookup(HOST, { all }, (error, address, family) => {
        resolve({ error, result: all ? address : [address, family] })
      })
    })
  }

  it('devolve o primeiro endereço ou todos, conforme a opção all', async () => {
    const resolver: Resolver = () => Promise.resolve(PUBLIC)
    expect(await run(resolver, false)).toEqual({ error: null, result: ['161.148.164.31', 4] })
    expect(await run(resolver, true)).toEqual({ error: null, result: PUBLIC })
  })

  it('falha na conexão se o DNS mudar para um endereço bloqueado (rebinding)', async () => {
    const result = await run(() => Promise.resolve([{ address: '127.0.0.1', family: 4 }]), false)
    expect(result.error).toBeInstanceOf(BlockedRequestError)
    const failed = await run(() => Promise.reject(new Error('NXDOMAIN')), false)
    expect(failed.error?.message).toBe('NXDOMAIN')
    const odd = await run(() => Promise.reject('texto'), true)
    expect(odd.error?.message).toBe('texto')
  })
})

describe('normalizeHeaders', () => {
  it('passa os nomes para minúsculas e junta valores repetidos', () => {
    expect(normalizeHeaders({ ETag: '"1"', 'Set-Cookie': ['a', 'b'], vazio: undefined })).toEqual({
      etag: '"1"',
      'set-cookie': 'a, b',
    })
  })
})

describe('transporte padrão', () => {
  it('é usado quando nenhum é injetado (sem rede: o DNS falso bloqueia antes)', async () => {
    const resolver = vi.fn<Resolver>(() => Promise.resolve([{ address: '10.0.0.1', family: 4 }]))
    const fetcher = createSafeFetcher({ allowedHosts: [HOST], resolver })
    await expect(fetcher.fetch({ url: 'https://www.gov.br/' })).rejects.toBeInstanceOf(
      BlockedRequestError,
    )
    expect(resolver).toHaveBeenCalledWith(HOST)
  })
})
