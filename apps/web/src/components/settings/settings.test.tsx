// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from '@/lib/density'
import { THEME_ATTRIBUTE } from '@/lib/theme'
import ptBR from '../../../messages/pt-BR.json'
import { type FakeApi, installFakeApi, ME, problem } from '../../../test/fake-api.ts'
import { SettingsView } from './settings-view.tsx'

vi.mock('next/navigation', () => ({
  usePathname: () => '/pt-BR/settings/',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

const download = vi.hoisted(() => ({ downloadJson: vi.fn() }))
vi.mock('@/lib/download', () => download)

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn(), startRegistration: vi.fn() }))
vi.mock('@simplewebauthn/browser', () => webauthn)

/** WebAuthn presente no navegador falso (o happy-dom não tem). */
class FakePublicKeyCredential {}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let api: FakeApi

const QUOTA = {
  day: '2026-11-15',
  user: { used: 3, limit: 30 },
  global: { used: 40, limit: 300 },
  resetAt: '2026-11-16T03:00:00.000Z',
}

const PASSKEYS = [
  { id: 'pk-1', name: 'Notebook', createdAt: '2026-11-14T10:00:00.000Z' },
  { id: 'pk-2', name: null, createdAt: '2026-11-15T10:00:00.000Z' },
]

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

async function render(ui: ReactNode = <SettingsView />): Promise<void> {
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
  // `/me` primeiro; as seções da conta só montam (e buscam a cota e as passkeys) depois dele.
  await settle()
  await settle()
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => {
    element.click()
  })
  await settle()
}

async function type(input: Element | null | undefined, value: string): Promise<void> {
  if (!(input instanceof HTMLInputElement)) throw new Error('campo não encontrado')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function button(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === text,
  )
}

function section(id: string): HTMLElement | null {
  return document.querySelector(`section[aria-labelledby="${id}-title"]`)
}

beforeEach(() => {
  api = installFakeApi()
  api.on('GET /api/v1/me', ME)
  api.on('GET /api/v1/me/quota', QUOTA)
  api.on('GET /api/auth/passkey/list-user-passkeys', PASSKEYS)
  browser.navigateTo.mockReset()
  download.downloadJson.mockReset()
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  document.documentElement.removeAttribute(DENSITY_ATTRIBUTE)
  vi.stubGlobal('PublicKeyCredential', FakePublicKeyCredential)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  webauthn.startRegistration.mockReset()
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('SettingsView', () => {
  it('mostra a conta, a cota do dia e as passkeys', async () => {
    await render()
    expect(section('account')?.textContent).toContain('ana@teko.localhost')
    expect(section('account')?.textContent).toContain('Brasil')
    expect(section('quota')?.textContent).toContain('3 de 30 perguntas hoje')
    expect(section('quota')?.textContent).toContain('40 de 300')
    expect(
      section('quota')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow'),
    ).toBe('3')
    const passkeys = section('passkeys')?.textContent ?? ''
    expect(passkeys).toContain('Notebook')
    expect(passkeys).toContain(ptBR.settings.passkeys.unnamed)
  })

  it('sem sessão, só as preferências e o aviso de carregamento', async () => {
    api.on('GET /api/v1/me', () => problem(401, 'unauthenticated'))
    await render()
    expect(section('account')).toBeNull()
    expect(section('preferences')).not.toBeNull()
  })

  it('com a API fora, avisa que a conta não carregou', async () => {
    api.on('GET /api/v1/me', () => problem(400, 'validation_error'))
    await render()
    expect(container.textContent).toContain(ptBR.settings.unavailable)
  })

  it('a cota indisponível mostra o erro da API', async () => {
    api.on('GET /api/v1/me/quota', () => problem(403, 'onboarding_required'))
    await render()
    expect(section('quota')?.textContent).toContain(ptBR.errors.onboarding_required)
  })

  it('cadastra uma passkey com nome e relê a lista', async () => {
    api.on('GET /api/auth/passkey/generate-register-options', { challenge: 'r' })
    api.on('POST /api/auth/passkey/verify-registration', { id: 'pk-3' })
    webauthn.startRegistration.mockResolvedValue({ id: 'cred', clientExtensionResults: {} })
    await render()
    const lists = api.calls.filter((call) => call.route.endsWith('list-user-passkeys')).length
    await type(section('passkeys')?.querySelector('input'), 'Celular')
    await click(button(ptBR.settings.passkeys.add))
    expect(api.calls.find((call) => call.route.endsWith('verify-registration'))?.body).toEqual({
      response: { id: 'cred' },
      name: 'Celular',
    })
    expect(section('passkeys')?.querySelector('[role="status"]')?.textContent).toBe(
      ptBR.settings.passkeys.added,
    )
    expect(api.calls.filter((call) => call.route.endsWith('list-user-passkeys')).length).toBe(
      lists + 1,
    )
  })

  it('sessão antiga não cadastra passkey e explica o motivo', async () => {
    api.on('GET /api/auth/passkey/generate-register-options', () => problem(403, 'forbidden'))
    await render()
    await click(button(ptBR.settings.passkeys.add))
    expect(section('passkeys')?.querySelector('[role="alert"]')?.textContent).toBe(
      ptBR.auth.passkey.reauthenticate,
    )
  })

  it('remove uma passkey pelo botão nomeado', async () => {
    api.on('POST /api/auth/passkey/delete-passkey', { status: true })
    await render()
    await click(document.querySelector('button[aria-label="Remover a passkey Notebook"]'))
    expect(api.calls.find((call) => call.route.endsWith('delete-passkey'))?.body).toEqual({
      id: 'pk-1',
    })
    expect(section('passkeys')?.querySelector('[role="status"]')?.textContent).toBe(
      ptBR.settings.passkeys.removed,
    )
  })

  it('exporta os dados como arquivo JSON', async () => {
    api.on(
      'GET /api/v1/me/export',
      () =>
        new Response(JSON.stringify({ exportedAt: '2026-11-15T00:00:00Z' }), {
          headers: {
            'content-type': 'application/json',
            'content-disposition': 'attachment; filename="teko-meus-dados.json"',
          },
        }),
    )
    await render()
    await click(button(ptBR.settings.data.export))
    expect(download.downloadJson).toHaveBeenCalledWith('teko-meus-dados.json', {
      exportedAt: '2026-11-15T00:00:00Z',
    })
    expect(section('data')?.textContent).toContain(ptBR.settings.data.exported)
  })

  it('a exportação que falha mostra o erro', async () => {
    api.on('GET /api/v1/me/export', () => problem(429, 'rate_limited'))
    await render()
    await click(button(ptBR.settings.data.export))
    expect(section('data')?.querySelector('[role="alert"]')?.textContent).toBe(
      ptBR.errors.rate_limited,
    )
  })

  it('excluir a conta exige a palavra digitada e sai para a inicial', async () => {
    api.on('DELETE /api/v1/me', () => new Response(null, { status: 204 }))
    await render()
    await click(button(ptBR.settings.delete.button))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(ptBR.settings.delete.title)
    const confirm = button(ptBR.settings.delete.confirm)
    expect(confirm?.disabled).toBe(true)
    await type(dialog?.querySelector('input'), 'excluir')
    expect(button(ptBR.settings.delete.confirm)?.disabled).toBe(false)
    await click(button(ptBR.settings.delete.confirm))
    expect(api.calls.some((call) => call.route === 'DELETE /api/v1/me')).toBe(true)
    expect(browser.navigateTo).toHaveBeenCalledWith('/pt-BR/')
  })

  it('a exclusão que falha fica no diálogo, e cancelar fecha', async () => {
    api.on('DELETE /api/v1/me', () => problem(401, 'unauthenticated'))
    await render()
    await click(button(ptBR.settings.delete.button))
    await type(document.querySelector('[role="dialog"] input'), 'EXCLUIR')
    await click(button(ptBR.settings.delete.confirm))
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe(
      ptBR.errors.unauthenticated,
    )
    expect(browser.navigateTo).not.toHaveBeenCalled()
    await click(button(ptBR.settings.delete.cancel))
    await settle(300)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('onboarding pendente aparece na conta e abre o diálogo opcional', async () => {
    api.on('GET /api/v1/me', { ...ME, onboarding: { ...ME.onboarding, required: true } })
    await render()
    expect(section('account')?.textContent).toContain(ptBR.settings.account.onboardingPending)
    await click(button(ptBR.settings.account.completeOnboarding))
    expect((await waitForElement('[role="dialog"]'))?.textContent).toContain(ptBR.onboarding.title)
  })

  it('sair encerra a sessão e recarrega na inicial', async () => {
    api.on('POST /api/auth/sign-out', { success: true })
    await render()
    await click(section('account')?.querySelector('button:last-of-type'))
    expect(browser.navigateTo).toHaveBeenCalledWith('/pt-BR/')
  })

  it('as preferências trocam tema e densidade e levam ao outro idioma pelo menu', async () => {
    await render()
    const preferences = section('preferences')
    const radio = (label: string) =>
      [...(preferences?.querySelectorAll('label') ?? [])]
        .find((element) => element.textContent === label)
        ?.querySelector('input')
    await click(radio('Escuro'))
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    await click(radio('Compacta'))
    expect(document.documentElement.getAttribute(DENSITY_ATTRIBUTE)).toBe('compact')
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBe('compact')
    expect(radio('Compacta')?.checked).toBe(true)
    await click(radio('Confortável'))
    expect(document.documentElement.hasAttribute(DENSITY_ATTRIBUTE)).toBe(false)
    const languageButton = preferences?.querySelector('button[aria-label="Idioma: Português"]')
    expect(languageButton?.textContent).toContain('Português')
    await click(languageButton)
    expect(document.querySelector('a[role="menuitem"][hreflang="en"]')?.getAttribute('href')).toBe(
      '/en/settings/',
    )
  })
})
