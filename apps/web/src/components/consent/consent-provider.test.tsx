// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analytics } from '@/lib/analytics'
import {
  CONSENT_STORAGE_KEY,
  parseConsentRecord,
  REJECT_ALL,
  writeConsent,
} from '@/lib/consent/storage'
import ptBR from '../../../messages/pt-BR.json'
import { ConsentPreferencesButton, ConsentProvider } from './consent-provider.tsx'

// Chave pública controlada por teste (no build real vem de NEXT_PUBLIC_POSTHOG_KEY).
const env = vi.hoisted(() => ({ posthogKey: undefined as string | undefined }))

// O carregador do SDK: o teste conta as chamadas (é o `import()` do PostHog na F6).
const loader = vi.hoisted(() => ({
  calls: 0,
  client: { capture: vi.fn(), setSurveysEnabled: vi.fn(), disable: vi.fn() },
}))

// A instância do app, com o adapter real, mas a chave e o carregador sob controle do teste.
vi.mock('@/lib/analytics', async () => {
  const { createAnalytics } = await import('@/lib/analytics/adapter')
  return {
    analytics: createAnalytics({
      get key() {
        return env.posthogKey
      },
      load: async () => {
        loader.calls += 1
        return loader.client
      },
    }),
  }
})

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function render(ui: ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <ConsentProvider>
          {ui}
          <ConsentPreferencesButton />
        </ConsentProvider>
      </NextIntlClientProvider>,
    )
  })
  await settle()
}

function banner(): HTMLElement | null {
  return document.querySelector('[data-testid="consent-banner"]')
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (element) => element.textContent?.trim() === name,
  )
  if (found === undefined) throw new Error(`botão "${name}" não encontrado`)
  return found
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click()
  })
  await settle()
}

/** Chaves do PostHog que o SDK gravaria (`ph_<chave>_posthog`, `__ph_opt_in_out_…`). */
function posthogKeys(storage: Storage): string[] {
  return Object.keys(storage).filter((key) => /^(__)?ph_|posthog/i.test(key))
}

function stored() {
  return parseConsentRecord(localStorage.getItem(CONSENT_STORAGE_KEY))
}

beforeEach(async () => {
  localStorage.clear()
  sessionStorage.clear()
  // A instância é única no módulo: cada teste começa com o cliente desligado.
  await analytics.applyConsent(null)
  env.posthogKey = undefined
  loader.calls = 0
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('ConsentProvider: primeira visita', () => {
  it('mostra o banner sem gravar nada no navegador', async () => {
    await render(<p>conteúdo</p>)
    expect(banner()).not.toBeNull()
    expect(banner()?.textContent).toContain(ptBR.consent.banner.title)
    expect(Object.keys(localStorage)).toEqual([])
    expect(Object.keys(sessionStorage)).toEqual([])
    expect(document.cookie).toBe('')
  })

  it('Aceitar, Recusar e Personalizar têm o mesmo peso visual', async () => {
    await render(null)
    const { accept, reject, customize } = ptBR.consent.banner
    const classes = [accept, reject, customize].map((name) => button(name).className)
    expect(new Set(classes).size).toBe(1)
  })

  it('o link da política aponta para /privacy do locale', async () => {
    await render(null)
    expect(banner()?.querySelector('a')?.getAttribute('href')).toBe('/pt-BR/privacy/')
  })
})

describe('ConsentProvider: escolhas', () => {
  it('Recusar grava a recusa com a versão da política e some com o banner', async () => {
    env.posthogKey = 'phc_teste'
    await render(null)
    await click(button(ptBR.consent.banner.reject))

    expect(banner()).toBeNull()
    expect(stored()?.choices).toEqual(REJECT_ALL)
    expect(loader.calls).toBe(0)
    expect(posthogKeys(localStorage)).toEqual([])
    expect(posthogKeys(sessionStorage)).toEqual([])
    expect(document.cookie).toBe('')
  })

  it('Aceitar grava a escolha e só então carrega o analytics (com a chave presente)', async () => {
    env.posthogKey = 'phc_teste'
    await render(null)
    expect(loader.calls).toBe(0)

    await click(button(ptBR.consent.banner.accept))
    expect(banner()).toBeNull()
    expect(stored()?.choices).toEqual({ analytics: true, surveys: true })
    expect(loader.calls).toBe(1)
    expect(loader.client.capture).toHaveBeenCalledWith('consent_updated', { analytics: true })
  })

  it('sem a chave pública, aceitar não carrega nada', async () => {
    await render(null)
    await click(button(ptBR.consent.banner.accept))
    expect(stored()?.choices.analytics).toBe(true)
    expect(loader.calls).toBe(0)
  })

  it('Personalizar abre as preferências, desligadas por padrão, e salva por categoria', async () => {
    await render(null)
    await click(button(ptBR.consent.banner.customize))

    expect(banner()).toBeNull()
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(ptBR.consent.preferences.title)
    const switches = [...document.querySelectorAll<HTMLElement>('[role="switch"]')]
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
    ])
    expect(switches[0]?.getAttribute('aria-labelledby')).toBeTruthy()

    await click(switches[0] as HTMLElement)
    await click(button(ptBR.consent.preferences.save))
    expect(stored()?.choices).toEqual({ analytics: true, surveys: false })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('fechar as preferências sem salvar traz o banner de volta', async () => {
    await render(null)
    await click(button(ptBR.consent.banner.customize))
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(banner()).not.toBeNull()
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
  })
})

describe('ConsentProvider: escolha já feita', () => {
  it('não mostra o banner; o link do rodapé reabre as preferências com a escolha salva', async () => {
    writeConsent(localStorage, { analytics: false, surveys: true })
    await render(null)
    expect(banner()).toBeNull()

    await click(button(ptBR.consent.footerLink))
    const switches = [...document.querySelectorAll<HTMLElement>('[role="switch"]')]
    expect(switches.map((element) => element.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
    ])
    await click(button(ptBR.consent.preferences.rejectAll))
    expect(stored()?.choices).toEqual(REJECT_ALL)
  })

  it('retirar o consentimento desliga o cliente carregado', async () => {
    env.posthogKey = 'phc_teste'
    writeConsent(localStorage, { analytics: true, surveys: false })
    await render(null)
    expect(loader.calls).toBe(1)

    await click(button(ptBR.consent.footerLink))
    await click(button(ptBR.consent.preferences.rejectAll))
    expect(loader.client.disable).toHaveBeenCalled()
  })

  it('escolha de outra versão da política volta a pedir consentimento', async () => {
    localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        policyVersion: '2000-01-01',
        decidedAt: '2000-01-01T00:00:00.000Z',
        choices: REJECT_ALL,
      }),
    )
    await render(null)
    expect(banner()).not.toBeNull()
  })
})

describe('ConsentProvider no HTML estático', () => {
  it('não renderiza banner nem preferências no servidor', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <ConsentProvider>
          <p>conteúdo</p>
        </ConsentProvider>
      </NextIntlClientProvider>,
    )
    expect(html).toBe('<p>conteúdo</p>')
    // O afterEach desmonta um root; aqui não há, então monta um vazio.
    container = document.createElement('div')
    root = createRoot(container)
  })

  it('o link do rodapé não aparece fora do provider', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <ConsentPreferencesButton />
      </NextIntlClientProvider>,
    )
    expect(html).toBe('')
    container = document.createElement('div')
    root = createRoot(container)
  })
})
