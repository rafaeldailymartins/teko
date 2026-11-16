import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_NAME_MAX_LENGTH,
  AuthMethod,
  authProvidersResponseSchema,
  EMAIL_MAX_LENGTH,
  emailSignInRequestSchema,
  emailSignUpRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './index.ts'

const SIGN_UP = { name: 'Ana', email: 'ana@example.com', password: 'a'.repeat(12) }

describe('política da conta por e-mail', () => {
  it('senha de 12 a 128 e nome de até 80', () => {
    expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, ACCOUNT_NAME_MAX_LENGTH]).toEqual([
      12, 128, 80,
    ])
    expect(EMAIL_MAX_LENGTH).toBe(254)
  })
})

describe('emailSignUpRequestSchema', () => {
  it('aceita o cadastro e apara o nome, mas não a senha', () => {
    const password = ` ${'b'.repeat(11)} `
    expect(emailSignUpRequestSchema.parse({ ...SIGN_UP, name: '  Ana  ', password })).toEqual({
      ...SIGN_UP,
      password,
    })
  })

  it.each([
    ['senha com 11', { password: 'a'.repeat(11) }],
    ['senha com 129', { password: 'a'.repeat(129) }],
    ['nome vazio', { name: '   ' }],
    ['nome com 81', { name: 'a'.repeat(81) }],
    ['nome com controle C0', { name: 'Ana\u0000' }],
    ['nome com DEL', { name: 'Ana\u007f' }],
    ['nome com controle C1', { name: 'Ana\u0085' }],
    ['e-mail inválido', { email: 'ana' }],
    ['e-mail com 255', { email: `${'a'.repeat(243)}@example.com` }],
    ['foto', { image: 'https://evil.example/a.png' }],
    ['campo extra', { isAdult: true }],
  ])('recusa %s', (_label, change) => {
    expect(emailSignUpRequestSchema.safeParse({ ...SIGN_UP, ...change }).success).toBe(false)
  })

  it('aceita os extremos', () => {
    for (const change of [
      { password: 'a'.repeat(128) },
      { name: 'a'.repeat(80) },
      { email: `${'a'.repeat(242)}@example.com` },
    ]) {
      expect(emailSignUpRequestSchema.safeParse({ ...SIGN_UP, ...change }).success).toBe(true)
    }
  })
})

describe('emailSignInRequestSchema', () => {
  it('na entrada, a senha só tem o teto', () => {
    const body = { email: 'ana@example.com', password: 'x' }
    expect(emailSignInRequestSchema.parse(body)).toEqual(body)
    expect(emailSignInRequestSchema.safeParse({ ...body, password: '' }).success).toBe(false)
    expect(emailSignInRequestSchema.safeParse({ ...body, password: 'a'.repeat(129) }).success).toBe(
      false,
    )
    expect(emailSignInRequestSchema.safeParse({ ...body, rememberMe: true }).success).toBe(false)
  })
})

describe('authProvidersResponseSchema', () => {
  it('lista só métodos conhecidos', () => {
    expect(
      authProvidersResponseSchema.parse({ methods: [AuthMethod.Email, AuthMethod.Passkey] }),
    ).toEqual({ methods: ['email', 'passkey'] })
    expect(authProvidersResponseSchema.safeParse({ methods: ['magic-link'] }).success).toBe(false)
  })
})
