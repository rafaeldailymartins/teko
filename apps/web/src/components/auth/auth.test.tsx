// @vitest-environment happy-dom
import { useMutation } from '@tanstack/react-query'
import { ErrorCode } from '@teko/shared/errors'
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { ApiError } from '@/lib/api/errors'
import { REJECT_ALL, writeConsent } from '@/lib/consent/storage'
import ptBR from '../../../messages/pt-BR.json'
import { type FakeApi, installFakeApi, ME, problem } from '../../../test/fake-api.ts'
import { SessionGate } from './session-gate.tsx'
import { SignInPanel } from './sign-in-panel.tsx'
import { UserMenu } from './user-menu.tsx'

const navigation = vi.hoisted(() => ({
  pathname: '/pt-BR/chat/',
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.search,
  useRouter: () => ({ push: navigation.push, replace: navigation.replace }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const browser = vi.hoisted(() => ({ navigateTo: vi.fn() }))
vi.mock('@/lib/browser', () => browser)

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => webauthn)

/** Uma mutação qualquer que a API recusa por política regional (a conversa, por exemplo). */
function AskRestricted() {
  const mutation = useMutation({
    mutationFn: async () => {
      throw new ApiError({ code: ErrorCode.RegionRestricted, status: 451 })
    },
  })
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      perguntar
    </button>
  )
}

/** WebAuthn presente no navegador falso (o happy-dom não tem). */
class FakePublicKeyCredential {}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let api: FakeApi

async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

/** Espera um elemento aparecer (o diálogo de onboarding vem de um chunk sob demanda). */
async function waitForElement(selector: string): Promise<Element | null> {
  for (let attempt = 0; attempt < 40 && document.querySelector(selector) === null; attempt++) {
    await settle(25)
  }
  return document.querySelector(selector)
}

async function render(ui: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <Providers>{ui}</Providers>
      </NextIntlClientProvider>,
    )
  })
  await settle()
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => {
    element.click()
  })
  await settle()
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(text),
  )
}

beforeEach(() => {
  api = installFakeApi()
  navigation.pathname = '/pt-BR/chat/'
  navigation.search = new URLSearchParams()
  navigation.push.mockReset()
  navigation.replace.mockReset()
  browser.navigateTo.mockReset()
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
  localStorage.clear()
  // Escolha de consentimento já feita: o banner (testado em consent-provider.test.tsx) fica fora.
  writeConsent(localStorage, REJECT_ALL)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  webauthn.startAuthentication.mockReset()
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('SignInPanel', () => {
  beforeEach(() => {
    api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
  })

  it('inicia o OAuth com o retorno saneado e vai para o provedor', async () => {
    navigation.search = new URLSearchParams({ callbackURL: '/pt-BR/history/?c=1' })
    api.on('POST /api/auth/sign-in/social', { url: 'https://github.com/login/oauth/authorize' })
    await render(<SignInPanel title="Entrar" />)
    expect(document.querySelector('h1')?.textContent).toBe('Entrar')
    await click(button('Entrar com GitHub'))
    expect(api.calls.find((call) => call.route === 'POST /api/auth/sign-in/social')?.body).toEqual({
      provider: 'github',
      callbackURL: '/pt-BR/history/?c=1',
      errorCallbackURL: '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fhistory%2F%3Fc%3D1',
    })
    expect(browser.navigateTo).toHaveBeenCalledWith('https://github.com/login/oauth/authorize')
  })

  it('um retorno de outra origem vira o chat', async () => {
    navigation.search = new URLSearchParams({ callbackURL: 'https://evil.example/' })
    api.on('POST /api/auth/sign-in/social', { url: 'https://accounts.google.com/o/oauth2' })
    await render(<SignInPanel title="Entrar" />)
    await click(button('Entrar com Google'))
    expect(api.calls.at(-1)?.body).toMatchObject({
      provider: 'google',
      callbackURL: '/pt-BR/chat/',
    })
  })

  it('mostra a falha do início do OAuth e reabilita os botões', async () => {
    api.on('POST /api/auth/sign-in/social', () => problem(429, 'rate_limited'))
    await render(<SignInPanel title="Entrar" />)
    await click(button('Entrar com GitHub'))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(ptBR.errors.rate_limited)
    expect(button('Entrar com GitHub')?.disabled).toBe(false)
    expect(browser.navigateTo).not.toHaveBeenCalled()
  })

  it('o ?error= do callback vira mensagem', async () => {
    navigation.search = new URLSearchParams({ error: 'access_denied' })
    await render(<SignInPanel title="Entrar" />)
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain(ptBR.auth.errors.title)
    expect(alert?.textContent).toContain(ptBR.auth.errors.cancelled)
  })

  it('region_restricted vira a página de aviso', async () => {
    navigation.search = new URLSearchParams({ error: 'region_restricted' })
    await render(<SignInPanel title="Entrar" />)
    expect(document.querySelector('h1')?.textContent).toBe(ptBR.auth.region.title)
    expect(button('Entrar com GitHub')).toBeUndefined()
  })

  it('entra com passkey, relê o /me e volta para o retorno', async () => {
    navigation.search = new URLSearchParams({ callbackURL: '/pt-BR/history/' })
    api.on('GET /api/auth/passkey/generate-authenticate-options', { challenge: 'c' })
    api.on('POST /api/auth/passkey/verify-authentication', { session: {} })
    webauthn.startAuthentication.mockResolvedValue({ id: 'cred', clientExtensionResults: {} })
    await render(<SignInPanel title="Entrar" />)
    await click(button('Entrar com passkey'))
    expect(navigation.replace).toHaveBeenCalledWith('/pt-BR/history/')
    expect(api.calls.filter((call) => call.route === 'GET /api/v1/me').length).toBeGreaterThan(1)
  })

  it('passkey cancelada mostra a mensagem da cerimônia', async () => {
    api.on('GET /api/auth/passkey/generate-authenticate-options', { challenge: 'c' })
    webauthn.startAuthentication.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    )
    await render(<SignInPanel title="Entrar" />)
    await click(button('Entrar com passkey'))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(ptBR.auth.passkey.cancelled)
  })

  it('sem WebAuthn, o botão de passkey some', async () => {
    vi.unstubAllGlobals()
    api = installFakeApi()
    api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
    await render(<SignInPanel title="Entrar" />)
    expect(button('Entrar com passkey')).toBeUndefined()
  })

  it('com sessão, oferece continuar para o retorno', async () => {
    api.on('GET /api/v1/me', ME)
    await render(<SignInPanel title="Entrar" />)
    expect(container.textContent).toContain('Você já entrou como Ana Souza.')
    expect(document.querySelector('a[href="/pt-BR/chat/"]')?.textContent).toBe('Continuar')
  })
})

describe('SessionGate', () => {
  it('sem sessão, manda para a entrada com o retorno à página atual', async () => {
    api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
    window.history.replaceState(null, '', '/pt-BR/chat/?q=abc')
    await render(<SessionGate />)
    expect(navigation.replace).toHaveBeenCalledWith(
      '/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F%3Fq%3Dabc',
    )
  })

  it('com o onboarding pronto, não mostra nada', async () => {
    api.on('GET /api/v1/me', ME)
    await render(<SessionGate />)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it('onboarding pendente abre o diálogo bloqueante, que conclui e some', async () => {
    const pending = {
      ...ME,
      onboarding: { ...ME.onboarding, required: true, acceptedTermsVersion: null },
    }
    api.on('GET /api/v1/me', pending)
    api.on('POST /api/v1/me/onboarding', ME)
    await render(<SessionGate />)
    const dialog = await waitForElement('[role="dialog"]')
    expect(dialog?.textContent).toContain(ptBR.onboarding.title)
    expect(dialog?.textContent).toContain(ptBR.onboarding.training.title)
    expect(dialog?.querySelector('a[href="/pt-BR/terms/"]')).not.toBeNull()
    expect(dialog?.querySelector('a[href="/pt-BR/privacy/"]')).not.toBeNull()
    expect(button('Continuar')?.disabled).toBe(true)

    // Esc não fecha o diálogo bloqueante.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await click(checkbox)
    }
    const select = document.querySelector('select')
    expect(select?.value).toBe('BR')
    await act(async () => {
      if (select) {
        select.value = 'PT'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })
    expect(button('Continuar')?.disabled).toBe(false)
    await click(button('Continuar'))
    expect(api.calls.find((call) => call.route === 'POST /api/v1/me/onboarding')?.body).toEqual({
      isAdult: true,
      termsVersion: '2026-11-14',
      countryOfResidence: 'PT',
    })
    await settle(300)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('Termos novos pedem o aceite de novo, com o título da mudança', async () => {
    api.on('GET /api/v1/me', {
      ...ME,
      onboarding: { ...ME.onboarding, required: true, currentTermsVersion: '2027-01-01' },
    })
    api.on('POST /api/v1/me/onboarding', () => problem(400, 'validation_error'))
    await render(<SessionGate />)
    expect((await waitForElement('[role="dialog"]'))?.textContent).toContain(
      ptBR.onboarding.titleTermsUpdate,
    )
    for (const checkbox of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      await click(checkbox)
    }
    await click(button('Continuar'))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      ptBR.errors.validation_error,
    )
    await click(button('Sair'))
    expect(api.calls.some((call) => call.route === 'POST /api/auth/sign-out')).toBe(true)
  })

  it('nas configurações o onboarding pendente não bloqueia', async () => {
    navigation.pathname = '/pt-BR/settings/'
    api.on('GET /api/v1/me', { ...ME, onboarding: { ...ME.onboarding, required: true } })
    await render(<SessionGate />)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('uma mutação recusada com region_restricted leva à página de aviso', async () => {
    api.on('GET /api/v1/me', ME)
    await render(
      <>
        <SessionGate />
        <AskRestricted />
      </>,
    )
    await click(button('perguntar'))
    expect(navigation.push).toHaveBeenCalledWith('/pt-BR/sign-in/?error=region_restricted')
  })
})

describe('UserMenu', () => {
  it('sem sessão, mostra "Entrar" com o retorno à página atual', async () => {
    api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
    await render(<UserMenu />)
    const link = document.querySelector('a')
    expect(link?.textContent).toBe('Entrar')
    expect(link?.getAttribute('href')).toBe('/pt-BR/sign-in/?callbackURL=%2Fpt-BR%2Fchat%2F')
  })

  it('com sessão, abre o menu com nome, e-mail, configurações e sair', async () => {
    api.on('GET /api/v1/me', ME)
    api.on('POST /api/auth/sign-out', { success: true })
    await render(<UserMenu />)
    const trigger = document.querySelector('button[aria-label="Conta de Ana Souza"]')
    expect(trigger?.textContent).toBe('AS')
    await click(trigger)
    const menu = document.querySelector('[role="menu"]')
    expect(menu?.textContent).toContain('ana@teko.localhost')
    const items = [...document.querySelectorAll('[role="menuitem"]')]
    await click(items.find((item) => item.textContent === 'Configurações'))
    expect(navigation.push).toHaveBeenCalledWith('/pt-BR/settings/')

    await click(document.querySelector('button[aria-label="Conta de Ana Souza"]'))
    await click(
      [...document.querySelectorAll('[role="menuitem"]')].find(
        (item) => item.textContent === 'Sair',
      ),
    )
    expect(api.calls.some((call) => call.route === 'POST /api/auth/sign-out')).toBe(true)
    expect(browser.navigateTo).toHaveBeenCalledWith('/pt-BR/')
  })
})
