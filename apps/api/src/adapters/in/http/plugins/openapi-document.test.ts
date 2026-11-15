import { describe, expect, it } from 'vitest'
import {
  normalizeWebOpenApi,
  OPENAPI_DOCUMENT_VERSION,
  serializeOpenApi,
  WEB_API_BASE_PATH,
} from './openapi-document.ts'

const SERVED = {
  openapi: '3.1.0',
  info: { title: 'Tekó API', version: '1.4.2-abc1234' },
  components: { schemas: {} },
  paths: {
    '/api/v1/questions': {
      post: { operationId: 'askQuestion' },
      get: { operationId: 'listHistory' },
    },
    '/healthz': { get: { operationId: 'getHealthDirect' } },
    '/api/healthz': { get: { operationId: 'getHealth' } },
    '/api/v1/coverage': { get: { operationId: 'getCoverage' } },
  },
}

describe('normalizeWebOpenApi', () => {
  it('tira o prefixo /api dos caminhos e o põe em servers', () => {
    const document = normalizeWebOpenApi(SERVED)
    expect(document['servers']).toEqual([{ url: WEB_API_BASE_PATH }])
    expect(Object.keys(document['paths'] as object)).toEqual([
      '/healthz',
      '/v1/coverage',
      '/v1/questions',
    ])
  })

  it('deixa de fora o que não está sob /api (o /healthz da infraestrutura)', () => {
    const paths = normalizeWebOpenApi(SERVED)['paths'] as Record<string, unknown>
    expect(paths['/healthz']).toEqual({ get: { operationId: 'getHealth' } })
  })

  it('fixa info.version e ordena métodos, sem perder o resto do documento', () => {
    const document = normalizeWebOpenApi(SERVED)
    expect(document['info']).toEqual({ title: 'Tekó API', version: OPENAPI_DOCUMENT_VERSION })
    expect(document['components']).toEqual({ schemas: {} })
    const questions = (document['paths'] as Record<string, object>)['/v1/questions']
    expect(Object.keys(questions ?? {})).toEqual(['get', 'post'])
  })

  it('é determinístico: a ordem de registro das rotas não muda o arquivo', () => {
    const shuffled = {
      ...SERVED,
      paths: Object.fromEntries(Object.entries(SERVED.paths).reverse()),
    }
    expect(serializeOpenApi(normalizeWebOpenApi(shuffled))).toBe(
      serializeOpenApi(normalizeWebOpenApi(SERVED)),
    )
  })

  it('recusa um documento sem info ou paths', () => {
    expect(() => normalizeWebOpenApi(null)).toThrow('documento OpenAPI sem `info` ou `paths`')
    expect(() => normalizeWebOpenApi({ info: {} })).toThrow()
  })
})

describe('serializeOpenApi', () => {
  it('JSON com 2 espaços e quebra de linha final', () => {
    expect(serializeOpenApi({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n')
  })
})
