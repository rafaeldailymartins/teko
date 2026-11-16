// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { REJECT_ALL, writeConsent } from '@/lib/consent/storage'
import { THEME_ATTRIBUTE, THEME_STORAGE_KEY } from '@/lib/theme'
import ptBR from '../../../messages/pt-BR.json'
import { AppHeader } from './app-header.tsx'
import { useCloseHistoryPanel, Workspace } from './workspace.tsx'

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
  // Escolha de consentimento já feita: o banner (testado em consent-provider.test.tsx) fica fora.
  writeConsent(localStorage, REJECT_ALL)
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
  it('marca a página atual na navegação principal', async () => {
    await render(<AppHeader />)
    const nav = document.querySelector('nav[aria-label="Navegação principal"]')
    const current = nav?.querySelector('[aria-current="page"]')
    expect(current?.getAttribute('href')).toBe('/pt-BR/chat/')
    expect(nav?.querySelectorAll('[aria-current]')).toHaveLength(1)
  })

  it('o menu de idioma leva à mesma página no outro idioma, com a query e a âncora', async () => {
    window.history.replaceState(null, '', '/pt-BR/chat/?c=abc&ref=2024-03#fim')
    await render(<AppHeader />)
    expect(document.querySelector('a[hreflang="en"]')).toBeNull()

    await click(document.querySelector('button[aria-label="Idioma"]'))
    const english = document.querySelector('[role="menuitem"][hreflang="en"]')
    expect(english?.tagName).toBe('A')
    expect(english?.getAttribute('href')).toBe('/en/chat/?c=abc&ref=2024-03#fim')
    expect(english?.getAttribute('lang')).toBe('en')
    expect(english?.textContent).toContain('English')
    const current = document.querySelector('[role="menuitem"][aria-current="true"]')
    expect(current?.textContent).toBe('Português')
    expect(current?.hasAttribute('href')).toBe(false)
    window.history.replaceState(null, '', '/')
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

/** Conteúdo de histórico que fecha o Sheet, como a lista de conversas faz ao abrir uma. */
function OpenConversation() {
  const closeHistory = useCloseHistoryPanel()
  return (
    <button type="button" onClick={closeHistory}>
      abrir conversa
    </button>
  )
}

/** Workspace com a citação controlada por fora, como a área de trabalho do chat faz. */
function ControlledWorkspace({
  initialOpen = false,
  history = <p>lista vazia</p>,
}: {
  readonly initialOpen?: boolean
  readonly history?: ReactNode
}) {
  const [open, setOpen] = useState(initialOpen)
  return (
    <Workspace
      history={history}
      compactActions={<a href="/pt-BR/chat/">nova</a>}
      citation={<p>texto da citação</p>}
      citationOpen={open}
      onCitationOpenChange={setOpen}
    >
      <p id="thread">conversa</p>
      <button type="button" data-citation-id="S1" onClick={() => setOpen(true)}>
        chip
      </button>
    </Workspace>
  )
}

/** Títulos das regiões nomeadas (painéis laterais) na ordem do documento. */
function regionTitles(): (string | null | undefined)[] {
  return [...document.querySelectorAll('section[aria-labelledby]')].map(
    (section) =>
      document.getElementById(section.getAttribute('aria-labelledby') ?? '')?.textContent,
  )
}

describe('Workspace', () => {
  it('no desktop mostra o histórico e a conversa, sem painel de citação vazio', async () => {
    await render(<ControlledWorkspace />)
    expect(regionTitles()).toEqual(['Histórico'])
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(document.body.textContent).not.toContain('texto da citação')
    expect(document.getElementById('thread')).not.toBeNull()
  })

  it('a citação aberta entra ao lado da conversa no lugar do histórico e fecha com Esc', async () => {
    await render(<ControlledWorkspace />)
    await click(byText('button', 'chip'))
    expect(regionTitles()).toEqual(['Citação'])
    expect(document.body.textContent).toContain('texto da citação')
    const separator = document.querySelector('[role="separator"]')
    expect(separator?.getAttribute('aria-label')).toBe('Redimensionar a citação')
    // O histórico vira o trilho, com o atalho de nova conversa à vista.
    expect(document.querySelector('button[aria-label="Mostrar o histórico"]')).not.toBeNull()
    expect(byText('a', 'nova')).toBeDefined()

    const chip = byText('button', 'chip')
    await act(async () => {
      chip?.focus()
      chip?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(regionTitles()).toEqual(['Histórico'])
  })

  it('o Esc no composer não fecha a citação, e o botão de fechar fecha', async () => {
    await render(<ControlledWorkspace initialOpen />)
    const input = document.createElement('textarea')
    document.body.append(input)
    await act(async () => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()
    expect(regionTitles()).toEqual(['Citação'])
    await click(document.querySelector('button[aria-label="Fechar a citação"]'))
    expect(regionTitles()).toEqual(['Histórico'])
  })

  it('mostrar o histórico com a citação aberta fecha a citação (duas colunas no máximo)', async () => {
    await render(<ControlledWorkspace initialOpen />)
    await click(document.querySelector('button[aria-label="Mostrar o histórico"]'))
    expect(regionTitles()).toEqual(['Histórico'])
    expect(document.body.textContent).not.toContain('texto da citação')
  })

  it('recolhe o histórico, lembra a escolha e leva o foco ao botão de abrir', async () => {
    await render(<ControlledWorkspace />)
    await click(document.querySelector('button[aria-label="Recolher o histórico"]'))
    expect(regionTitles()).toEqual([])
    const expand = document.querySelector('button[aria-label="Mostrar o histórico"]')
    expect(document.activeElement).toBe(expand)
    expect(localStorage.getItem('teko-history-panel')).toBe('collapsed')

    await act(async () => root.unmount())
    container.remove()
    await render(<ControlledWorkspace />)
    expect(regionTitles()).toEqual([])
    await click(document.querySelector('button[aria-label="Mostrar o histórico"]'))
    expect(regionTitles()).toEqual(['Histórico'])
    expect(localStorage.getItem('teko-history-panel')).toBeNull()
  })

  it('no celular deixa só a conversa e abre o histórico num sheet', async () => {
    setViewportWidth(375)
    await render(<ControlledWorkspace />)
    expect(document.querySelectorAll('section[aria-labelledby]')).toHaveLength(0)
    expect(document.querySelector('[role="separator"]')).toBeNull()
    expect(document.getElementById('thread')).not.toBeNull()
    // Sem citação aberta, nada de botão "Citação": o Drawer abre pelo chip.
    expect(byText('button', 'Citação')).toBeUndefined()

    await click(byText('button', 'Histórico'))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('lista vazia')
    expect(dialog?.querySelector('button')?.textContent).toContain('Fechar')
  })

  it('o conteúdo do histórico fecha o sheet ao abrir uma conversa', async () => {
    setViewportWidth(375)
    await render(<ControlledWorkspace history={<OpenConversation />} />)
    await click(byText('button', 'Histórico'))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await click(byText('button', 'abrir conversa'))
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('no celular abre a citação num drawer pelo chip', async () => {
    setViewportWidth(375)
    await render(<ControlledWorkspace />)
    await click(byText('button', 'chip'))
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('texto da citação')
  })

  it('a conversa continua montada quando a janela cruza 768 px', async () => {
    await render(<ControlledWorkspace />)
    const thread = document.getElementById('thread')
    await act(async () => setViewportWidth(375))
    await settle()
    expect(document.getElementById('thread')).toBe(thread)
  })
})
