import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import {
  createRequestIdGenerator,
  isAcceptableRequestId,
  REQUEST_ID_HEADER,
  registerRequestIdHeader,
} from './request-id.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function rawRequest(headers: IncomingMessage['headers']): IncomingMessage {
  const request = new IncomingMessage(new Socket())
  request.headers = headers
  return request
}

describe('isAcceptableRequestId', () => {
  it.each([
    '6f1c2a5e-6d0b-4e61-9a43-2a1f0e4e7d1b',
    'abcdefgh',
    'req:01HZX.ABC_def-1',
    'a'.repeat(128),
  ])('aceita %j', (value) => {
    expect(isAcceptableRequestId(value)).toBe(true)
  })

  it.each([
    undefined,
    ['a', 'b'],
    '',
    'short',
    'a'.repeat(129),
    '-leading-dash',
    'tem espaço aqui',
    'quebra\nde-linha',
    '<script>x</script>',
  ])('rejeita %j', (value) => {
    expect(isAcceptableRequestId(value)).toBe(false)
  })
})

describe('createRequestIdGenerator', () => {
  const fromCaddy = createRequestIdGenerator(REQUEST_ID_HEADER)

  it('reaproveita o X-Request-Id do Caddy quando válido', () => {
    const id = '6f1c2a5e-6d0b-4e61-9a43-2a1f0e4e7d1b'
    expect(fromCaddy(rawRequest({ [REQUEST_ID_HEADER]: id }))).toBe(id)
  })

  it('na Vercel usa o x-vercel-id da borda', () => {
    const fromVercel = createRequestIdGenerator('x-vercel-id')
    const id = 'gru1::gru1::8lfqm-1762780000000-0a1b2c3d4e5f'
    expect(
      fromVercel(rawRequest({ 'x-vercel-id': id, [REQUEST_ID_HEADER]: 'cliente-123456' })),
    ).toBe(id)
  })

  it('gera um UUID quando o header falta ou é inválido', () => {
    expect(fromCaddy(rawRequest({}))).toMatch(UUID_PATTERN)
    expect(fromCaddy(rawRequest({ [REQUEST_ID_HEADER]: 'x y' }))).toMatch(UUID_PATTERN)
  })

  it('sem header de origem, ignora o que o cliente mandar', () => {
    const always = createRequestIdGenerator(null)
    expect(always(rawRequest({ [REQUEST_ID_HEADER]: 'cliente-123456' }))).toMatch(UUID_PATTERN)
  })
})

describe('registerRequestIdHeader', () => {
  it('ecoa o request id na resposta', async () => {
    const app = Fastify({
      genReqId: createRequestIdGenerator(REQUEST_ID_HEADER),
      requestIdHeader: false,
    })
    registerRequestIdHeader(app)
    app.get('/', async () => ({ ok: true }))

    const res = await app.inject({
      url: '/',
      headers: { [REQUEST_ID_HEADER]: 'caddy-request-0001' },
    })
    expect(res.headers[REQUEST_ID_HEADER]).toBe('caddy-request-0001')

    const generated = await app.inject({ url: '/' })
    expect(generated.headers[REQUEST_ID_HEADER]).toMatch(UUID_PATTERN)
    await app.close()
  })
})
