import { z } from 'zod'

/**
 * Login (ADR 0036): os métodos de entrada que o ambiente oferece e a política da conta por e-mail e
 * senha, a mesma na API (gancho do Better Auth em `/sign-up/email`) e no formulário do web.
 */

/** Métodos de entrada. `passkey` exige uma passkey cadastrada antes, com sessão ativa. */
export const AuthMethod = {
  GitHub: 'github',
  Google: 'google',
  Passkey: 'passkey',
  Email: 'email',
} as const
export type AuthMethod = (typeof AuthMethod)[keyof typeof AuthMethod]
export const authMethodSchema = z.enum(AuthMethod)

/** `GET /api/v1/auth/providers`: público, sem segredo, na ordem em que a tela mostra. */
export const authProvidersResponseSchema = z
  .object({ methods: z.array(authMethodSchema) })
  .meta({ description: 'Métodos de entrada ativos no ambiente' })

export type AuthProvidersResponse = z.infer<typeof authProvidersResponseSchema>

/**
 * Senha: de 12 a 128 caracteres, contados como o Better Auth conta (`string.length`, unidades
 * UTF-16: um emoji vale 2). Sem regra de composição (NIST SP 800-63B); a senha não é aparada, e o
 * hash (scrypt do Better Auth) normaliza em NFKC antes de calcular.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

/** Nome exibido da conta por e-mail, já sem os espaços das pontas. */
export const ACCOUNT_NAME_MAX_LENGTH = 80

/** Teto de um endereço de e-mail (RFC 5321). */
export const EMAIL_MAX_LENGTH = 254

/** Caracteres de controle (C0, DEL e C1), que não entram no nome. */
const CONTROL_CHARACTERS = /\p{Cc}/u

const emailSchema = z.email().max(EMAIL_MAX_LENGTH)

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

/** `POST /api/auth/sign-up/email` (Better Auth): só estes campos; foto e campos extras dão 400. */
export const emailSignUpRequestSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(ACCOUNT_NAME_MAX_LENGTH)
    .refine((value) => !CONTROL_CHARACTERS.test(value), { error: 'caractere de controle' }),
  email: emailSchema,
  password: passwordSchema,
})

export type EmailSignUpRequest = z.infer<typeof emailSignUpRequestSchema>

/**
 * `POST /api/auth/sign-in/email` (Better Auth). A senha só tem o teto: uma senha curta demais
 * recebe o mesmo erro genérico de qualquer senha errada.
 */
export const emailSignInRequestSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})

export type EmailSignInRequest = z.infer<typeof emailSignInRequestSchema>
