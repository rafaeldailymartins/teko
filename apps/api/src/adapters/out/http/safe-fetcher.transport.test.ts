import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo, LookupFunction } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BlockedRequestError } from '#app/ports/safe-fetcher.ts'
import { nodeTransport, type TransportRequest } from './safe-fetcher.ts'

/**
 * Transporte real (`node:http`) contra um servidor local: a exceção http do portal antigo do SPED
 * (ADR 0028) passa por este caminho. O `lookup` dos testes devolve 127.0.0.1 para qualquer nome,
 * o que também prova que o transporte usa o `lookup` recebido (o do `SafeFetcher` é o validado).
 */

const BODY = 'conteúdo do guia'
let server: Server
let port = 0
let lastHeaders: IncomingHttpHeaders = {}

const loopback: LookupFunction = (_hostname, options, callback) => {
  if (options.all === true) {
    callback(null, [{ address: '127.0.0.1', family: 4 }])
  } else {
    callback(null, '127.0.0.1', 4)
  }
}

function request(path: string, maxBytes = 1024): TransportRequest {
  return {
    url: new URL(`http://fonte.test:${String(port)}${path}`),
    method: 'GET',
    headers: { 'user-agent': 'teko-teste' },
    maxBytes,
    signal: AbortSignal.timeout(5000),
    lookup: loopback,
  }
}

beforeAll(async () => {
  server = createServer((incoming, response) => {
    lastHeaders = incoming.headers
    if (incoming.url === '/grande-declarado') {
      response.writeHead(200, { 'content-length': '4096' })
      response.end('x'.repeat(4096))
      return
    }
    if (incoming.url === '/grande-em-partes') {
      response.writeHead(200)
      for (let part = 0; part < 8; part += 1) {
        response.write('y'.repeat(512))
      }
      response.end()
      return
    }
    response.writeHead(302, { location: '/estatico/guia.pdf', 'X-Teste': 'A' })
    response.end(BODY)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
})

describe('nodeTransport em http', () => {
  it('devolve status, cabeçalhos minúsculos e corpo, pelo lookup recebido', async () => {
    const response = await nodeTransport(request('/arquivo/download/7233'))
    expect(response.status).toBe(302)
    expect(response.headers['location']).toBe('/estatico/guia.pdf')
    expect(response.headers['x-teste']).toBe('A')
    expect(new TextDecoder().decode(response.body)).toBe(BODY)
    expect(lastHeaders['user-agent']).toBe('teko-teste')
    expect(lastHeaders.host).toBe(`fonte.test:${String(port)}`)
  })

  it('recusa content-length acima do teto antes de ler o corpo', async () => {
    await expect(nodeTransport(request('/grande-declarado'))).rejects.toBeInstanceOf(
      BlockedRequestError,
    )
  })

  it('recusa corpo em partes que passa do teto', async () => {
    await expect(nodeTransport(request('/grande-em-partes'))).rejects.toThrow(/teto de 1024 bytes/)
  })
})
