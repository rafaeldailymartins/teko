// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { REJECT_ALL, writeConsent } from '@/lib/consent/storage'
import ptBR from '../../../messages/pt-BR.json'
import { type FakeApi, installFakeApi, ME, problem } from '../../../test/fake-api.ts'
import { SignInPanel } from './sign-in-panel.tsx'

/**
 * Entrada da onda 2 do redesign (`redesign-auth-ui`): métodos conforme `GET /auth/providers` e o
 * formulário de e-mail e senha (validação inline pelos schemas, mensagens de falha e retorno).
 */

const navigation = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/sign-in/',
  useSearchParams: () => navigation.search,
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/browser', () => ({ navigateTo: vi.fn() }))

/** WebAuthn presente no navegador falso (o happy-dom não tem). */
class FakePublicKeyCredential {}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const email = ptBR.auth.email
const PASSWORD = 'uma frase secreta longa'

let container: HTMLDivElement
let root: Root
let api: FakeApi

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function render(): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <Providers>
          <SignInPanel title="Entrar" />
        </Providers>
      </NextIntlClientProvider>,
    )
  })
  await settle()
  await settle()
  // O formulário de e-mail vem de um chunk sob demanda.
  for (let attempt = 0; attempt < 20 && document.querySelector('form') === null; attempt++) {
    await settle(25)
  }
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => {
    element.click()
  })
  await settle()
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
}

function tab(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (element) => element.textContent === text,
  )
}

/** Campo pelo rótulo visível (`<label for>`). */
function field(label: string): HTMLInputElement {
  const element = [...document.querySelectorAll('label')].find(
    (candidate) => candidate.textContent === label,
  )
  const input = document.getElementById(element?.htmlFor ?? '')
  if (!(input instanceof HTMLInputElement)) throw new Error(`campo ${label} não encontrado`)
  return input
}

async function type(label: string, value: string): Promise<void> {
  const input = field(label)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function blur(label: string): Promise<void> {
  await act(async () => {
    field(label).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  const form = document.querySelector('form')
  await act(async () => {
    form?.requestSubmit()
  })
  await settle()
  await settle()
}

/** Mensagem de erro ligada ao campo pelo `aria-describedby`. */
function fieldError(label: string): string | null {
  const input = field(label)
  const ids = input.getAttribute('aria-describedby')?.split(' ') ?? []
  const error = ids
    .map((id) => document.getElementById(id))
    .find((node) => node?.getAttribute('role') === 'alert')
  return error?.textContent ?? null
}

function alerts(): string[] {
  return [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? '')
}

function routes(): string[] {
  return api.calls.map((call) => call.route)
}

beforeEach(() => {
  api = installFakeApi()
  api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
  api.on('GET /api/v1/auth/providers', { methods: ['passkey', 'email'] })
  navigation.search = new URLSearchParams()
  navigation.replace.mockReset()
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
  localStorage.clear()
  writeConsent(localStorage, REJECT_ALL)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('métodos de entrada', () => {
  it('sem OAuth apps (o caso local), só passkey e e-mail', async () => {
    await render()
    expect(button(ptBR.auth.signIn.github)).toBeUndefined()
    expect(button(ptBR.auth.signIn.google)).toBeUndefined()
    expect(button(ptBR.auth.signIn.passkey)).toBeDefined()
    expect(container.textContent).toContain(ptBR.auth.signIn.divider)
    expect(tab(email.signIn)?.getAttribute('aria-selected')).toBe('true')
  })

  it('com os OAuth apps, GitHub e Google com os símbolos', async () => {
    api.on('GET /api/v1/auth/providers', { methods: ['github', 'google', 'passkey', 'email'] })
    await render()
    const github = button(ptBR.auth.signIn.github)
    const google = button(ptBR.auth.signIn.google)
    expect(github?.querySelector('svg path')).not.toBeNull()
    // O "G" do Google nas quatro cores oficiais.
    const fills = [...(google?.querySelectorAll('svg path') ?? [])].map((path) =>
      path.getAttribute('fill'),
    )
    expect(fills).toEqual(['#EA4335', '#4285F4', '#FBBC05', '#34A853'])
  })

  it('só e-mail: sem a divisória', async () => {
    api.on('GET /api/v1/auth/providers', { methods: ['email'] })
    await render()
    expect(button(ptBR.auth.signIn.passkey)).toBeUndefined()
    expect(container.textContent).not.toContain(ptBR.auth.signIn.divider)
    expect(field(email.email)).toBeDefined()
  })

  it('enquanto os métodos carregam, o esqueleto do formulário', async () => {
    api.on('GET /api/v1/auth/providers', () => new Promise<Response>(() => {}))
    await render()
    const status = document.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-label')).toBe(ptBR.auth.signIn.loading)
    expect(status?.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5)
    expect(document.querySelector('form')).toBeNull()
  })

  it('sem a lista de métodos, ainda oferece a passkey e o e-mail', async () => {
    api.on('GET /api/v1/auth/providers', () => problem(400, 'validation_error'))
    await render()
    expect(button(ptBR.auth.signIn.passkey)).toBeDefined()
    expect(field(email.email)).toBeDefined()
  })

  it('account_not_linked diz que o e-mail usa outro método', async () => {
    navigation.search = new URLSearchParams({ error: 'account_not_linked' })
    await render()
    expect(alerts().join(' ')).toContain(ptBR.auth.errors.accountNotLinked)
    expect(ptBR.auth.errors.accountNotLinked).toContain('outro método de entrada')
  })

  it('com sessão, oferece continuar com as iniciais', async () => {
    api.on('GET /api/v1/me', ME)
    await render()
    expect(container.textContent).toContain('AS')
    expect(document.querySelector('form')).toBeNull()
  })
})

describe('entrar com e-mail e senha', () => {
  it('valida no envio, sem chamar a API, e foca o primeiro campo inválido', async () => {
    await render()
    await type(email.email, 'ana@exemplo')
    await submit()
    expect(fieldError(email.email)).toBe(email.validation.emailInvalid)
    expect(fieldError(email.password)).toBe(email.validation.passwordRequired)
    expect(field(email.email).getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field(email.email))
    expect(routes()).not.toContain('POST /api/auth/sign-in/email')
  })

  it('o erro aparece ao sair do campo e some quando o valor fica válido', async () => {
    await render()
    await type(email.email, 'ana@')
    expect(fieldError(email.email)).toBeNull()
    await blur(email.email)
    expect(fieldError(email.email)).toBe(email.validation.emailInvalid)
    await type(email.email, 'ana@exemplo.com')
    expect(fieldError(email.email)).toBeNull()
    expect(field(email.email).hasAttribute('aria-invalid')).toBe(false)
  })

  it('entra, relê o /me e segue para o retorno saneado', async () => {
    navigation.search = new URLSearchParams({ callbackURL: '/pt-BR/history/' })
    api.on('POST /api/auth/sign-in/email', { token: 't', user: {} })
    await render()
    const reads = routes().filter((route) => route === 'GET /api/v1/me').length
    await type(email.email, '  ana@exemplo.com ')
    await type(email.password, PASSWORD)
    await submit()
    expect(api.calls.find((call) => call.route === 'POST /api/auth/sign-in/email')?.body).toEqual({
      email: 'ana@exemplo.com',
      password: PASSWORD,
    })
    expect(routes().filter((route) => route === 'GET /api/v1/me').length).toBeGreaterThan(reads)
    expect(navigation.replace).toHaveBeenCalledWith('/pt-BR/history/')
  })

  it('credenciais erradas: a mensagem genérica, e o formulário volta', async () => {
    api.on('POST /api/auth/sign-in/email', () =>
      Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }),
    )
    await render()
    await type(email.email, 'ana@exemplo.com')
    await type(email.password, 'qualquer coisa')
    await submit()
    expect(alerts()).toContain(email.failures.invalidCredentials)
    expect(button(email.submitSignIn)?.disabled).toBe(false)
    expect(navigation.replace).not.toHaveBeenCalled()
    // Mexer num campo limpa a falha anterior.
    await type(email.password, 'outra coisa')
    expect(alerts()).not.toContain(email.failures.invalidCredentials)
  })

  it('tentativas demais: pede para esperar', async () => {
    api.on('POST /api/auth/sign-in/email', () => Response.json({}, { status: 429 }))
    await render()
    await type(email.email, 'ana@exemplo.com')
    await type(email.password, PASSWORD)
    await submit()
    expect(alerts()).toContain(email.failures.rateLimited)
  })

  it('o aviso de que não há recuperação aponta para os Termos', async () => {
    await render()
    expect(container.textContent).toContain('Esqueceu a senha?')
    expect(document.querySelector('form a[href="/pt-BR/terms/"]')).not.toBeNull()
  })
})

describe('criar conta', () => {
  async function openSignUp(): Promise<void> {
    await render()
    await click(tab(email.signUp))
  }

  it('a aba guarda o e-mail e mostra nome, medidor da senha e o aviso', async () => {
    await render()
    await type(email.email, 'ana@exemplo.com')
    await click(tab(email.signUp))
    expect(tab(email.signUp)?.getAttribute('aria-selected')).toBe('true')
    expect(field(email.email).value).toBe('ana@exemplo.com')
    expect(field(email.name)).toBeDefined()
    expect(field(email.password).getAttribute('autocomplete')).toBe('new-password')
    await type(email.password, 'curta')
    expect(container.textContent).toContain('5 de 12 caracteres')
    expect(container.textContent).toContain('O Tekó não confirma o e-mail nem recupera senhas')
  })

  it('valida nome, e-mail e o mínimo de 12 caracteres', async () => {
    await openSignUp()
    await type(email.name, '   ')
    await type(email.email, 'sem-arroba')
    await type(email.password, 'curta')
    await submit()
    expect(fieldError(email.name)).toBe(email.validation.nameRequired)
    expect(fieldError(email.email)).toBe(email.validation.emailInvalid)
    expect(fieldError(email.password)).toBe('A senha precisa de pelo menos 12 caracteres.')
    expect(document.activeElement).toBe(field(email.name))
    expect(routes()).not.toContain('POST /api/auth/sign-up/email')
  })

  it('enviar vazio marca os três campos', async () => {
    await openSignUp()
    await submit()
    expect(fieldError(email.name)).toBe(email.validation.nameRequired)
    expect(fieldError(email.email)).toBe(email.validation.emailInvalid)
    expect(fieldError(email.password)).toBe(email.validation.passwordRequired)
  })

  it('mostrar a senha troca o tipo do campo', async () => {
    await openSignUp()
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-pressed]')
    expect(toggle?.getAttribute('aria-label')).toBe(email.showPassword)
    expect(field(email.password).type).toBe('password')
    await click(toggle)
    expect(toggle?.getAttribute('aria-pressed')).toBe('true')
    expect(field(email.password).type).toBe('text')
  })

  it('cria a conta, entra e segue para o chat', async () => {
    api.on('POST /api/auth/sign-up/email', { token: null, user: {} })
    api.on('POST /api/auth/sign-in/email', { token: 't', user: {} })
    await openSignUp()
    await type(email.name, '  Ana Souza ')
    await type(email.email, 'ana@exemplo.com')
    await type(email.password, PASSWORD)
    await submit()
    expect(api.calls.find((call) => call.route === 'POST /api/auth/sign-up/email')?.body).toEqual({
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      password: PASSWORD,
    })
    expect(routes()).toContain('POST /api/auth/sign-in/email')
    expect(navigation.replace).toHaveBeenCalledWith('/pt-BR/chat/')
  })

  it('e-mail que já tem conta: sugere o método de sempre, sem confirmar a conta', async () => {
    api.on('POST /api/auth/sign-up/email', { token: null, user: {} })
    api.on('POST /api/auth/sign-in/email', () => Response.json({}, { status: 401 }))
    await openSignUp()
    await type(email.name, 'Ana')
    await type(email.email, 'ana@exemplo.com')
    await type(email.password, PASSWORD)
    await submit()
    expect(alerts()).toContain(email.failures.accountUnavailable)
    expect(email.failures.accountUnavailable).toContain('entre pelo método de sempre')
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('a recusa do servidor vira a mensagem do campo correspondente', async () => {
    api.on('POST /api/auth/sign-up/email', () =>
      Response.json({ code: 'INVALID_NAME' }, { status: 400 }),
    )
    await openSignUp()
    await type(email.name, 'Ana')
    await type(email.email, 'ana@exemplo.com')
    await type(email.password, PASSWORD)
    await submit()
    expect(alerts()).toContain(
      'Confira o nome: ele não pode ficar vazio nem passar de 80 caracteres.',
    )
  })
})
