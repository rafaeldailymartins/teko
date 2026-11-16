import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deletePasskey,
  EmailAuthError,
  EmailAuthFailure,
  emailAuthFailureOf,
  listPasskeys,
  OAuthProvider,
  PasskeyError,
  PasskeyFailure,
  passkeyFailureOf,
  registerPasskey,
  signInWithEmail,
  signInWithPasskey,
  signOut,
  signUpWithEmail,
  startSocialSignIn,
  supportsPasskeys,
} from './auth.ts'
import { apiClient } from './client.ts'
import { ApiError } from './errors.ts'

const webauthn = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

vi.mock('@simplewebauthn/browser', () => webauthn)

/** WebAuthn presente no escopo (o Node não tem). */
class FakePublicKeyCredential {}

interface Call {
  readonly method: string
  readonly url: string
  readonly body: unknown
}

let calls: Call[]
let responses: Map<string, () => Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function respond(path: string, make: () => Response): void {
  responses.set(path, make)
}

beforeEach(() => {
  calls = []
  responses = new Map()
  apiClient.setConfig({
    baseUrl: 'http://teko.test/api',
    fetch: async (input: RequestInfo | URL) => {
      const request = new Request(input)
      const url = new URL(request.url)
      const text = await request.text()
      calls.push({
        method: request.method,
        url: `${url.pathname}${url.search}`,
        body: text === '' ? undefined : JSON.parse(text),
      })
      const make = responses.get(url.pathname)
      return make === undefined ? json({ code: 'NOT_FOUND' }, 404) : make()
    },
  })
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
})

afterEach(() => {
  vi.unstubAllGlobals()
  webauthn.startAuthentication.mockReset()
  webauthn.startRegistration.mockReset()
})

describe('startSocialSignIn', () => {
  it('manda provedor, retorno e retorno de erro, e devolve a URL do provedor', async () => {
    respond('/api/auth/sign-in/social', () =>
      json({ url: 'https://github.com/login/oauth/authorize?client_id=x', redirect: true }),
    )
    const url = await startSocialSignIn(OAuthProvider.GitHub, {
      callbackURL: '/pt-BR/chat/',
      errorCallbackURL: '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F',
    })
    expect(url).toBe('https://github.com/login/oauth/authorize?client_id=x')
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/auth/sign-in/social',
        body: {
          provider: 'github',
          callbackURL: '/pt-BR/chat/',
          errorCallbackURL: '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F',
        },
      },
    ])
  })

  it('recusa uma URL de provedor que não é http(s)', async () => {
    respond('/api/auth/sign-in/social', () => json({ url: 'javascript:alert(1)' }))
    await expect(
      startSocialSignIn(OAuthProvider.Google, { callbackURL: '/', errorCallbackURL: '/' }),
    ).rejects.toThrow()
  })

  it('falha HTTP do Better Auth vira ApiError', async () => {
    respond('/api/auth/sign-in/social', () => json({ code: 'PROVIDER_NOT_FOUND' }, 404))
    await expect(
      startSocialSignIn(OAuthProvider.Google, { callbackURL: '/', errorCallbackURL: '/' }),
    ).rejects.toMatchObject({ name: 'ApiError', code: 'not_found', status: 404 })
  })
})

describe('entrada e cadastro por e-mail', () => {
  const ACCOUNT = { name: 'Ana', email: 'ana@example.com', password: 'uma senha longa' }
  const INVALID = { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }

  async function failureOf(run: Promise<unknown>): Promise<unknown> {
    const error: unknown = await run.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(EmailAuthError)
    return (error as EmailAuthError).failure
  }

  it('a entrada manda só e-mail e senha', async () => {
    respond('/api/auth/sign-in/email', () => json({ token: 't', user: { id: 'u' } }))
    await signInWithEmail({ email: ACCOUNT.email, password: ACCOUNT.password })
    expect(calls).toEqual([
      {
        method: 'POST',
        url: '/api/auth/sign-in/email',
        body: { email: ACCOUNT.email, password: ACCOUNT.password },
      },
    ])
  })

  it('o cadastro cria a conta e entra em seguida', async () => {
    respond('/api/auth/sign-up/email', () => json({ token: null, user: { id: 'u' } }))
    respond('/api/auth/sign-in/email', () => json({ token: 't', user: { id: 'u' } }))
    await signUpWithEmail(ACCOUNT)
    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/sign-up/email', body: ACCOUNT },
      {
        method: 'POST',
        url: '/api/auth/sign-in/email',
        body: { email: ACCOUNT.email, password: ACCOUNT.password },
      },
    ])
  })

  it('senha errada na entrada vira invalidCredentials', async () => {
    respond('/api/auth/sign-in/email', () => json(INVALID, 401))
    expect(await failureOf(signInWithEmail(ACCOUNT))).toBe(EmailAuthFailure.InvalidCredentials)
  })

  it('cadastro aceito com entrada recusada vira accountUnavailable', async () => {
    respond('/api/auth/sign-up/email', () => json({ token: null, user: { id: 'u' } }))
    respond('/api/auth/sign-in/email', () => json(INVALID, 401))
    expect(await failureOf(signUpWithEmail(ACCOUNT))).toBe(EmailAuthFailure.AccountUnavailable)
  })

  it('o cadastro recusado não tenta entrar', async () => {
    respond('/api/auth/sign-up/email', () => json({ code: 'PASSWORD_TOO_SHORT' }, 400))
    expect(await failureOf(signUpWithEmail(ACCOUNT))).toBe(EmailAuthFailure.PasswordTooShort)
    expect(calls.map((call) => call.url)).toEqual(['/api/auth/sign-up/email'])
  })

  it('o 429 da entrada depois do cadastro continua rateLimited', async () => {
    respond('/api/auth/sign-up/email', () => json({ token: null, user: { id: 'u' } }))
    respond('/api/auth/sign-in/email', () => json({ message: 'Too many requests' }, 429))
    expect(await failureOf(signUpWithEmail(ACCOUNT))).toBe(EmailAuthFailure.RateLimited)
  })

  it('falha de servidor segue como ApiError', async () => {
    respond('/api/auth/sign-in/email', () => json({ code: 'X' }, 500))
    await expect(signInWithEmail(ACCOUNT)).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
    })
  })
})

describe('emailAuthFailureOf', () => {
  const failure = (status: number, cause?: unknown) =>
    emailAuthFailureOf(new ApiError({ code: 'validation_error', status, cause }))

  it.each([
    ['PASSWORD_TOO_SHORT', 'passwordTooShort'],
    ['PASSWORD_TOO_LONG', 'passwordTooLong'],
    ['INVALID_EMAIL', 'invalidEmail'],
    ['INVALID_NAME', 'invalidName'],
    ['VALIDATION_ERROR', 'invalidInput'],
  ])('400 com %s vira %s', (code, expected) => {
    expect(failure(400, { code, message: 'x' })).toBe(expected)
  })

  it('distingue 401, 429, 422 e o resto', () => {
    expect(failure(401)).toBe('invalidCredentials')
    expect(failure(429)).toBe('rateLimited')
    expect(failure(422, 'texto')).toBe('invalidInput')
    expect(failure(400, { code: 7 })).toBe('invalidInput')
    expect(failure(400, null)).toBe('invalidInput')
    expect(failure(403)).toBeNull()
    expect(failure(503)).toBeNull()
    expect(emailAuthFailureOf(new Error('rede'))).toBeNull()
  })
})

describe('signOut', () => {
  it('faz POST em /auth/sign-out', async () => {
    respond('/api/auth/sign-out', () => json({ success: true }))
    await signOut()
    expect(calls).toEqual([{ method: 'POST', url: '/api/auth/sign-out', body: {} }])
  })
})

describe('passkeyFailureOf', () => {
  it.each([
    [
      Object.assign(new Error('x'), { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }),
      'alreadyRegistered',
    ],
    [Object.assign(new Error('x'), { code: 'ERROR_CEREMONY_ABORTED' }), 'cancelled'],
    [Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'cancelled'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'cancelled'],
    [new Error('outro'), 'failed'],
    ['não é erro', 'failed'],
  ])('%o vira %s', (error, failure) => {
    expect(passkeyFailureOf(error)).toBe(failure)
  })
})

describe('supportsPasskeys', () => {
  it('olha o PublicKeyCredential do escopo', () => {
    expect(supportsPasskeys({ PublicKeyCredential: FakePublicKeyCredential })).toBe(true)
    expect(supportsPasskeys({ PublicKeyCredential: 'não' })).toBe(false)
    expect(supportsPasskeys({})).toBe(false)
  })
})

describe('signInWithPasskey', () => {
  it('pede as opções, roda a cerimônia e verifica sem as extensões do cliente', async () => {
    respond('/api/auth/passkey/generate-authenticate-options', () => json({ challenge: 'c1' }))
    respond('/api/auth/passkey/verify-authentication', () => json({ session: {} }))
    webauthn.startAuthentication.mockResolvedValue({
      id: 'cred',
      response: { clientDataJSON: 'x' },
      clientExtensionResults: { credProps: {} },
    })
    await signInWithPasskey()
    expect(webauthn.startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'c1' } })
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/auth/passkey/generate-authenticate-options',
      'POST /api/auth/passkey/verify-authentication',
    ])
    expect(calls[1]?.body).toEqual({ response: { id: 'cred', response: { clientDataJSON: 'x' } } })
  })

  it('diálogo cancelado vira PasskeyError cancelled, sem verificar', async () => {
    respond('/api/auth/passkey/generate-authenticate-options', () => json({ challenge: 'c1' }))
    webauthn.startAuthentication.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    )
    await expect(signInWithPasskey()).rejects.toMatchObject({
      name: 'PasskeyError',
      failure: PasskeyFailure.Cancelled,
    })
    expect(calls).toHaveLength(1)
  })

  it('sem WebAuthn, nem chama a API', async () => {
    vi.unstubAllGlobals()
    await expect(signInWithPasskey()).rejects.toEqual(new PasskeyError(PasskeyFailure.Unsupported))
    await expect(registerPasskey()).rejects.toMatchObject({ failure: PasskeyFailure.Unsupported })
    expect(calls).toEqual([])
  })
})

describe('registerPasskey', () => {
  it('manda o nome nas opções e na verificação', async () => {
    respond('/api/auth/passkey/generate-register-options', () => json({ challenge: 'r1' }))
    respond('/api/auth/passkey/verify-registration', () => json({ id: 'pk' }))
    webauthn.startRegistration.mockResolvedValue({ id: 'cred', clientExtensionResults: {} })
    await registerPasskey('  notebook  ')
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/auth/passkey/generate-register-options?name=notebook',
      'POST /api/auth/passkey/verify-registration',
    ])
    expect(calls[1]?.body).toEqual({ response: { id: 'cred' }, name: 'notebook' })
  })

  it('sem nome, não manda o campo', async () => {
    respond('/api/auth/passkey/generate-register-options', () => json({ challenge: 'r1' }))
    respond('/api/auth/passkey/verify-registration', () => json({ id: 'pk' }))
    webauthn.startRegistration.mockResolvedValue({ id: 'cred', clientExtensionResults: {} })
    await registerPasskey('   ')
    expect(calls[0]?.url).toBe('/api/auth/passkey/generate-register-options')
    expect(calls[1]?.body).toEqual({ response: { id: 'cred' } })
  })

  it('sessão antiga (403) pede para entrar de novo', async () => {
    respond('/api/auth/passkey/generate-register-options', () =>
      json({ code: 'SESSION_NOT_FRESH' }, 403),
    )
    await expect(registerPasskey()).rejects.toMatchObject({
      failure: PasskeyFailure.Reauthenticate,
    })
  })

  it('outra falha das opções passa adiante como ApiError', async () => {
    respond('/api/auth/passkey/generate-register-options', () => json({}, 500))
    await expect(registerPasskey()).rejects.toBeInstanceOf(ApiError)
  })

  it('autenticador já cadastrado', async () => {
    respond('/api/auth/passkey/generate-register-options', () => json({ challenge: 'r1' }))
    webauthn.startRegistration.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' }),
    )
    await expect(registerPasskey()).rejects.toMatchObject({
      failure: PasskeyFailure.AlreadyRegistered,
    })
  })
})

describe('listPasskeys e deletePasskey', () => {
  it('lista com data e nome opcional', async () => {
    respond('/api/auth/passkey/list-user-passkeys', () =>
      json([
        { id: 'a', name: 'Notebook', createdAt: '2026-11-14T10:00:00.000Z', publicKey: 'x' },
        { id: 'b', name: null, createdAt: '2026-11-15T10:00:00.000Z' },
      ]),
    )
    const passkeys = await listPasskeys()
    expect(passkeys.map((passkey) => [passkey.id, passkey.name])).toEqual([
      ['a', 'Notebook'],
      ['b', null],
    ])
    expect(passkeys[0]?.createdAt).toEqual(new Date('2026-11-14T10:00:00.000Z'))
  })

  it('remove pelo id', async () => {
    respond('/api/auth/passkey/delete-passkey', () => json({ status: true }))
    await deletePasskey('a')
    expect(calls).toEqual([
      { method: 'POST', url: '/api/auth/passkey/delete-passkey', body: { id: 'a' } },
    ])
  })
})
