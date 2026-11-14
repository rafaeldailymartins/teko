import { makeSignature } from 'better-auth/crypto'
import { describe, expect, it } from 'vitest'
import { parseDevSessionArgs, sessionCookieName, signSessionToken } from './dev-session.ts'

describe('signSessionToken', () => {
  it('assina como o Better Auth (HMAC-SHA256 em base64, URL-encoded)', async () => {
    const secret = 'teste'.repeat(8)
    const token = 'abc_DEF-123'
    const expected = encodeURIComponent(`${token}.${await makeSignature(token, secret)}`)
    expect(signSessionToken(token, secret)).toBe(expected)
  })
})

describe('sessionCookieName', () => {
  it('usa o prefixo __Secure- só em https', () => {
    expect(sessionCookieName('teko', true)).toBe('__Secure-teko.session_token')
    expect(sessionCookieName('teko-stg', false)).toBe('teko-stg.session_token')
  })
})

describe('parseDevSessionArgs', () => {
  it('tem padrões para o usuário de desenvolvimento', () => {
    expect(parseDevSessionArgs([])).toEqual({
      email: 'dev@teko.localhost',
      name: 'Dev Tekó',
      country: 'BR',
    })
  })

  it('aceita e-mail, nome e país', () => {
    expect(
      parseDevSessionArgs(['--email', 'e2e@teko.localhost', '--name', 'E2E', '--country', 'PT']),
    ).toEqual({ email: 'e2e@teko.localhost', name: 'E2E', country: 'PT' })
  })

  it('erro de uso sai com o código 64', () => {
    expect(() => parseDevSessionArgs(['--country', 'brasil'])).toThrow(
      expect.objectContaining({ exitCode: 64 }),
    )
    expect(() => parseDevSessionArgs(['--outro'])).toThrow(
      expect.objectContaining({ exitCode: 64 }),
    )
  })
})
