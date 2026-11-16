import {
  emailSignInRequestSchema,
  emailSignUpRequestSchema,
  PASSWORD_MIN_LENGTH,
} from '@teko/shared/contracts'
import type { z } from 'zod'

/**
 * Validação do formulário de e-mail e senha pelos mesmos schemas que a API aplica
 * (`@teko/shared/contracts`, ADR 0036): o formulário só troca cada recusa por uma mensagem de campo.
 */

/** Modo do formulário: entrar numa conta ou criar uma. */
export const EmailFormMode = {
  SignIn: 'signIn',
  SignUp: 'signUp',
} as const

export type EmailFormMode = (typeof EmailFormMode)[keyof typeof EmailFormMode]

export const EmailFormField = {
  Name: 'name',
  Email: 'email',
  Password: 'password',
} as const

export type EmailFormField = (typeof EmailFormField)[keyof typeof EmailFormField]

/** Por que um campo foi recusado (a chave da mensagem em `auth.email.validation`). */
export const EmailFieldIssue = {
  NameRequired: 'nameRequired',
  NameTooLong: 'nameTooLong',
  NameInvalid: 'nameInvalid',
  EmailInvalid: 'emailInvalid',
  PasswordRequired: 'passwordRequired',
  PasswordTooShort: 'passwordTooShort',
  PasswordTooLong: 'passwordTooLong',
} as const

export type EmailFieldIssue = (typeof EmailFieldIssue)[keyof typeof EmailFieldIssue]

export interface EmailFormValues {
  readonly name: string
  readonly email: string
  readonly password: string
}

export type EmailFormErrors = Partial<Record<EmailFormField, EmailFieldIssue>>

/** Campos de cada modo, na ordem da tela (o foco vai para o primeiro inválido). */
export const EMAIL_FORM_FIELDS: Readonly<Record<EmailFormMode, readonly EmailFormField[]>> = {
  [EmailFormMode.SignIn]: [EmailFormField.Email, EmailFormField.Password],
  [EmailFormMode.SignUp]: [EmailFormField.Name, EmailFormField.Email, EmailFormField.Password],
}

function issueOf(field: EmailFormField, issue: z.core.$ZodIssue, values: EmailFormValues) {
  switch (field) {
    case EmailFormField.Name:
      if (issue.code === 'too_big') return EmailFieldIssue.NameTooLong
      return issue.code === 'too_small' || values.name.trim() === ''
        ? EmailFieldIssue.NameRequired
        : EmailFieldIssue.NameInvalid
    case EmailFormField.Email:
      return EmailFieldIssue.EmailInvalid
    default:
      if (values.password === '') return EmailFieldIssue.PasswordRequired
      return issue.code === 'too_big'
        ? EmailFieldIssue.PasswordTooLong
        : EmailFieldIssue.PasswordTooShort
  }
}

function isField(value: PropertyKey | undefined): value is EmailFormField {
  return value === 'name' || value === 'email' || value === 'password'
}

/**
 * Erros dos campos do modo (o primeiro de cada campo), ou `{}` quando o formulário pode ir. O
 * e-mail vai aparado: espaço colado nas pontas não é erro de quem digita.
 */
export function validateEmailForm(mode: EmailFormMode, values: EmailFormValues): EmailFormErrors {
  const email = values.email.trim()
  const result =
    mode === EmailFormMode.SignUp
      ? emailSignUpRequestSchema.safeParse({ ...values, email })
      : emailSignInRequestSchema.safeParse({ email, password: values.password })
  if (result.success) {
    return {}
  }
  const errors: EmailFormErrors = {}
  for (const issue of result.error.issues) {
    const [field] = issue.path
    if (isField(field) && errors[field] === undefined) {
      errors[field] = issueOf(field, issue, values)
    }
  }
  return errors
}

/** Corpo que vai para a API, com o e-mail e o nome aparados (a senha nunca é aparada). */
export function emailFormRequest(values: EmailFormValues): EmailFormValues {
  return { name: values.name.trim(), email: values.email.trim(), password: values.password }
}

/** Quanto falta para a senha nova chegar ao mínimo (de 0 a 1), para o medidor do cadastro. */
export function passwordProgress(password: string): number {
  return Math.min(1, password.length / PASSWORD_MIN_LENGTH)
}
