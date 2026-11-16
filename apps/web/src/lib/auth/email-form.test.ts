import { describe, expect, it } from 'vitest'
import {
  EMAIL_FORM_FIELDS,
  EmailFieldIssue,
  EmailFormMode,
  emailFormRequest,
  passwordProgress,
  validateEmailForm,
} from './email-form.ts'

const VALID = { name: 'Ana Souza', email: 'ana@exemplo.com', password: 'uma frase longa' }

describe('validateEmailForm', () => {
  it('formulário válido nos dois modos, com o e-mail aparado', () => {
    expect(validateEmailForm(EmailFormMode.SignUp, VALID)).toEqual({})
    expect(
      validateEmailForm(EmailFormMode.SignIn, { ...VALID, email: ' ana@exemplo.com ' }),
    ).toEqual({})
  })

  it('cadastro: nome vazio, longo demais ou com caractere de controle', () => {
    expect(validateEmailForm(EmailFormMode.SignUp, { ...VALID, name: '   ' })).toEqual({
      name: EmailFieldIssue.NameRequired,
    })
    expect(validateEmailForm(EmailFormMode.SignUp, { ...VALID, name: 'a'.repeat(81) })).toEqual({
      name: EmailFieldIssue.NameTooLong,
    })
    expect(validateEmailForm(EmailFormMode.SignUp, { ...VALID, name: 'Ana\u0007' })).toEqual({
      name: EmailFieldIssue.NameInvalid,
    })
  })

  it('cadastro: senha vazia, curta ou longa demais', () => {
    expect(validateEmailForm(EmailFormMode.SignUp, { ...VALID, password: '' }).password).toBe(
      EmailFieldIssue.PasswordRequired,
    )
    expect(
      validateEmailForm(EmailFormMode.SignUp, { ...VALID, password: 'a'.repeat(11) }).password,
    ).toBe(EmailFieldIssue.PasswordTooShort)
    expect(
      validateEmailForm(EmailFormMode.SignUp, { ...VALID, password: 'a'.repeat(129) }).password,
    ).toBe(EmailFieldIssue.PasswordTooLong)
  })

  it('entrada: a senha só precisa existir e caber no teto; o nome não conta', () => {
    expect(
      validateEmailForm(EmailFormMode.SignIn, { name: '', email: VALID.email, password: 'curta' }),
    ).toEqual({})
    expect(validateEmailForm(EmailFormMode.SignIn, { ...VALID, password: '' })).toEqual({
      password: EmailFieldIssue.PasswordRequired,
    })
    expect(
      validateEmailForm(EmailFormMode.SignIn, { ...VALID, password: 'a'.repeat(129) }).password,
    ).toBe(EmailFieldIssue.PasswordTooLong)
  })

  it('e-mail inválido ou longo demais nos dois modos', () => {
    for (const mode of [EmailFormMode.SignIn, EmailFormMode.SignUp]) {
      expect(validateEmailForm(mode, { ...VALID, email: 'ana@' }).email).toBe(
        EmailFieldIssue.EmailInvalid,
      )
      expect(validateEmailForm(mode, { ...VALID, email: `${'a'.repeat(250)}@x.com` }).email).toBe(
        EmailFieldIssue.EmailInvalid,
      )
    }
  })

  it('os campos de cada modo, na ordem da tela', () => {
    expect(EMAIL_FORM_FIELDS[EmailFormMode.SignIn]).toEqual(['email', 'password'])
    expect(EMAIL_FORM_FIELDS[EmailFormMode.SignUp]).toEqual(['name', 'email', 'password'])
  })
})

describe('emailFormRequest', () => {
  it('apara nome e e-mail, nunca a senha', () => {
    expect(emailFormRequest({ name: ' Ana ', email: ' a@b.co ', password: ' senha ' })).toEqual({
      name: 'Ana',
      email: 'a@b.co',
      password: ' senha ',
    })
  })
})

describe('passwordProgress', () => {
  it('vai de 0 a 1 até o mínimo de 12 caracteres', () => {
    expect(passwordProgress('')).toBe(0)
    expect(passwordProgress('a'.repeat(6))).toBe(0.5)
    expect(passwordProgress('a'.repeat(12))).toBe(1)
    expect(passwordProgress('a'.repeat(40))).toBe(1)
  })
})
