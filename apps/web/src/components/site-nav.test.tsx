// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '@/components/providers'
import { REJECT_ALL, writeConsent } from '@/lib/consent/storage'
import ptBR from '../../messages/pt-BR.json'
import { SiteMobileMenu, SiteNav } from './site-nav.tsx'

const navigation = vi.hoisted(() => ({ pathname: '/pt-BR/coverage' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
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

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => {
    element.click()
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', async () => Response.json({}))
  localStorage.clear()
  writeConsent(localStorage, REJECT_ALL)
  navigation.pathname = '/pt-BR/coverage'
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

describe('SiteNav', () => {
  it('lista as páginas do site e marca a atual', async () => {
    await render(<SiteNav />)
    const links = [...document.querySelectorAll('nav[aria-label="Navegação do site"] a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/pt-BR/coverage/',
      '/pt-BR/about/',
    ])
    expect(links[0]?.getAttribute('aria-current')).toBe('page')
    expect(links[1]?.hasAttribute('aria-current')).toBe(false)
  })
})

describe('SiteMobileMenu', () => {
  it('abre um sheet com as páginas, o código-fonte e a chamada para o app', async () => {
    navigation.pathname = '/pt-BR/about/'
    await render(<SiteMobileMenu />)
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await click(document.querySelector('button[aria-label="Abrir o menu"]'))
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain(ptBR.common.menu.title)
    const hrefs = [...(dialog?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([
      '/pt-BR/coverage/',
      '/pt-BR/about/',
      '/pt-BR/privacy/',
      '/pt-BR/terms/',
      'https://github.com/rafaeldailymartins/teko',
      '/pt-BR/chat/',
    ])
    expect(dialog?.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe(
      '/pt-BR/about/',
    )
  })
})
