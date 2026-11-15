import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachmentFilename,
  deleteAccount,
  EXPORT_FILENAME,
  fetchMyDataExport,
  submitOnboarding,
} from './account.ts'
import { apiClient } from './client.ts'

const ME = {
  id: '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b',
  name: 'Ana',
  email: 'ana@teko.localhost',
  image: null,
  onboarding: {
    required: false,
    currentTermsVersion: '2026-11-14',
    acceptedTermsVersion: '2026-11-14',
    countryOfResidence: 'BR',
  },
}

let requests: { method: string; path: string; body: string }[]
let reply: () => Response

beforeEach(() => {
  requests = []
  reply = () => new Response(null, { status: 204 })
  apiClient.setConfig({
    baseUrl: 'http://teko.test/api',
    fetch: async (input: RequestInfo | URL) => {
      const request = new Request(input)
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        body: await request.text(),
      })
      return reply()
    },
  })
})

describe('attachmentFilename', () => {
  it('lê o filename do Content-Disposition', () => {
    expect(attachmentFilename('attachment; filename="teko-meus-dados.json"')).toBe(
      'teko-meus-dados.json',
    )
  })

  it('cai no padrão sem header ou com nome inseguro', () => {
    expect(attachmentFilename(null)).toBe(EXPORT_FILENAME)
    expect(attachmentFilename('attachment')).toBe(EXPORT_FILENAME)
    expect(attachmentFilename('attachment; filename="../../etc/passwd"')).toBe(EXPORT_FILENAME)
  })
})

describe('mutações da conta', () => {
  it('submitOnboarding manda o corpo e devolve o /me', async () => {
    reply = () => Response.json(ME)
    const me = await submitOnboarding({
      isAdult: true,
      termsVersion: '2026-11-14',
      countryOfResidence: 'BR',
    })
    expect(me).toEqual(ME)
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/v1/me/onboarding',
        body: '{"isAdult":true,"termsVersion":"2026-11-14","countryOfResidence":"BR"}',
      },
    ])
  })

  it('fetchMyDataExport devolve o JSON com o nome do anexo', async () => {
    reply = () =>
      Response.json(
        { exportedAt: '2026-11-15T00:00:00Z' },
        { headers: { 'content-disposition': 'attachment; filename="teko-meus-dados.json"' } },
      )
    expect(await fetchMyDataExport()).toEqual({
      filename: 'teko-meus-dados.json',
      data: { exportedAt: '2026-11-15T00:00:00Z' },
    })
    expect(requests[0]).toMatchObject({ method: 'GET', path: '/api/v1/me/export' })
  })

  it('deleteAccount faz DELETE /v1/me e falha com ApiError', async () => {
    await deleteAccount()
    expect(requests[0]).toMatchObject({ method: 'DELETE', path: '/api/v1/me' })
    reply = () =>
      Response.json(
        { type: 'about:blank', title: 'x', status: 401, code: 'unauthenticated' },
        { status: 401, headers: { 'content-type': 'application/problem+json' } },
      )
    await expect(deleteAccount()).rejects.toMatchObject({ code: 'unauthenticated' })
  })
})
