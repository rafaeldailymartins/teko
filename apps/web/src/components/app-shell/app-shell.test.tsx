// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from '@/lib/theme'
import ptBR from '../../../messages/pt-BR.json'
import { AppHeader } from './app-header.tsx'
import { Workspace } from './workspace.tsx'

const navigation = vi.hoisted(() => ({ pathname: '/pt-BR/chat', push: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}))

// O `next/link` do App Router exige o roteador montado; aqui basta o `<a>`.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

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
}

/** Espera os efeitos e animações do Base UI assentarem. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => {
    element.click()
  })
  await settle()
}

async function press(init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
  })
  await settle()
}

function byText(selector: string, text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text,
  )
}

function setViewportWidth(width: number): void {
  // happy-dom avalia `matchMedia` contra o tamanho da janela.
  ;(
    window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }
  ).happyDOM.setViewport({ width })
}

/** Sem sessão: `GET /me` responde 401, como a API (nada sai da máquina nos testes). */
function unauthenticated(): Response {
  return Response.json(
    {
      type: 'about:blank',
      title: 'Authentication required',
      status: 401,
      code: 'unauthenticated',
      traceId: 'trace-teste',
    },
    { status: 401, headers: { 'content-type': 'application/problem+json' } },
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => unauthenticated())
  navigation.pathname = '/pt-BR/chat'
  navigation.push.mockReset()
  localStorage.clear()
  document.documentElement.removeAttribute(THEME_ATTRIBUTE)
  setViewportWidth(1280)
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('AppHeader', () => {
  it('marca a página atual na navegação principal e troca o idioma mantendo a página', async () => {
    await render(<AppHeader />)
    const nav = document.querySelector('nav[aria-label="Navegação principal"]')
    const current = nav?.querySelector('[aria-current="page"]')
    expect(current?.getAttribute('href')).toBe('/pt-BR/chat/')
    expect(nav?.querySelectorAll('[aria-current]')).toHaveLength(1)
    expect(document.querySelector('a[hreflang="en"]')?.getAttribute('href')).toBe('/en/chat/')
  })

  it('abre a paleta com Ctrl+K e navega para a página escolhida', async () => {
    await render(<AppHeader />)
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await press({ key: 'k', ctrlKey: true })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('Paleta de comandos')

    await click(byText('[cmdk-item]', 'Histórico'))
    expect(navigation.push).toHaveBeenCalledWith('/pt-BR/history/')
  })

  it('abre a paleta pelo botão e troca o tema por ela', async () => {
    await render(<AppHeader />)
    await click(document.querySelector('button[aria-keyshortcuts]'))
    await click(byText('[cmdk-item]', 'Escuro'))
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('dark')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('o seletor de tema grava a escolha', async () => {
    await render(<AppHeader />)
    await click(document.querySelector('button[aria-label="Tema"]'))
    await click(byText('[role="menuitemradio"]', 'Claro'))
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('o seletor de tema mostra a preferência salva e volta a seguir o sistema', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    await render(<AppHeader />)
    await click(document.querySelector('button[aria-label="Tema"]'))
    const checked = document.querySelector('[role="menuitemradio"][aria-checked="true"]')
    expect(checked?.textContent).toBe('Escuro')

    await click(byText('[role="menuitemradio"]', 'Igual ao sistema'))
    expect(document.documentElement.hasAttribute(THEME_ATTRIBUTE)).toBe(false)
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })
})

describe('Workspace', () => {
  const workspace = (
    <Workspace history={<p>lista vazia</p>} citation={<p>sem citação</p>}>
      <p id="thread">conversa</p>
    </Workspace>
  )

  it('mostra três painéis com separadores nomeados no desktop', async () => {
    await render(workspace)
    const regions = [...document.querySelectorAll('section[aria-labelledby]')].map(
      (section) =>
        document.getElementById(section.getAttribute('aria-labelledby') ?? '')?.textContent,
    )
    expect(regions).toEqual(['Histórico', 'Citação'])
    const separators = [...document.querySelectorAll('[role="separator"]')].map((separator) =>
      separator.getAttribute('aria-label'),
    )
    expect(separators).toEqual(['Redimensionar o histórico', 'Redimensionar a citação'])
    expect(document.getElementById('thread')).not.toBeNull()
  })

  it('no celular deixa só a conversa e abre o histórico num sheet', async () => {
    setViewportWidth(375)
    await render(workspace)
    expect(document.querySelectorAll('section[aria-labelledby]')).toHaveLength(0)
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(document.getElementById('thread')).not.toBeNull()

    await click(byText('button', 'Histórico'))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('lista vazia')
    expect(dialog?.querySelector('button')?.textContent).toContain('Fechar')
  })

  it('no celular abre a citação num drawer', async () => {
    setViewportWidth(375)
    await render(workspace)
    await click(byText('button', 'Citação'))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('sem citação')
  })

  it('a conversa continua montada quando a janela cruza 768 px', async () => {
    await render(workspace)
    const thread = document.getElementById('thread')
    await act(async () => setViewportWidth(375))
    await settle()
    expect(document.getElementById('thread')).toBe(thread)
  })
})
