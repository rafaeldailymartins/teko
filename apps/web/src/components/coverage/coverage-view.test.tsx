// @vitest-environment happy-dom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api/client'
import { installFakeApi, problem } from '../../../test/fake-api.ts'
import { byText, click, type Rendered, renderClient, settle } from '../../../test/render.tsx'
import { CoverageView } from './coverage-view.tsx'

/**
 * Página de cobertura no DOM: a lista vem de `GET /api/v1/coverage` (pública, sem `/me`), com
 * carregamento, erro com "tentar de novo", vazio e os dados por jurisdição e família.
 */

const COVERAGE = {
  corpusVersion: 11,
  families: [
    {
      family: 'rcte',
      jurisdiction: 'GO',
      covered: [
        { from: '1998-01-01', to: '2004-01-01' },
        { from: '2005-01-01', to: '2026-11-11' },
      ],
      verifiedAt: '2026-11-10',
    },
    {
      family: 'efd-icms-ipi',
      jurisdiction: 'BR',
      covered: [{ from: '2025-01-01', to: '2026-11-09' }],
      verifiedAt: '2026-11-08',
    },
    {
      family: 'nova-familia',
      jurisdiction: 'GO',
      covered: [],
      verifiedAt: '2026-11-01',
    },
  ],
}

let rendered: Rendered | undefined
let defaultBaseUrl: string | undefined

beforeAll(() => {
  defaultBaseUrl = apiClient.getConfig().baseUrl
  apiClient.setConfig({ baseUrl: 'http://teko.test/api' })
})

afterEach(async () => {
  await rendered?.unmount()
  rendered = undefined
  vi.unstubAllGlobals()
})

afterAll(() => {
  apiClient.setConfig({ baseUrl: defaultBaseUrl ?? '/api' })
})

async function waitFor<T>(find: () => T | null | undefined, timeout = 2000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const found = find()
    if (found !== null && found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`tempo esgotado: ${document.body.innerHTML}`)
    await settle()
  }
}

describe('CoverageView', () => {
  it('mostra as famílias por jurisdição, com fontes, períodos, lacunas e verificação', async () => {
    const api = installFakeApi()
    api.on('GET /api/v1/coverage', COVERAGE)
    rendered = await renderClient(<CoverageView />)
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      'Carregando a cobertura',
    )

    const rcte = await waitFor(() => rendered?.container.querySelector('[data-family="rcte"]'))
    expect(api.calls.map((call) => call.route)).toEqual(['GET /api/v1/coverage'])

    const headings = [...rendered.container.querySelectorAll('h2')].map((h) => h.textContent)
    expect(headings).toEqual(['Federal', 'Goiás'])
    expect(rendered.container.textContent).toContain(
      'Fontes verificadas pela última vez em 10/11/2026.',
    )
    expect(rendered.container.textContent).toContain('Versão do corpus: 11')

    expect(rcte.querySelector('h3')?.textContent).toBe('RCTE de Goiás')
    expect(rcte.textContent).toContain('Decreto nº 4.852/1997')
    expect(rcte.textContent).toContain('01/01/1998 a 31/12/2003')
    expect(rcte.textContent).toContain('01/01/2005 a 10/11/2026')
    expect(rcte.querySelector('[data-gap]')?.textContent).toBe('01/01/2004 a 31/12/2004')
    expect(rcte.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-10')
    const segments = [...rcte.querySelectorAll<HTMLElement>('[data-segment]')]
    expect(segments.map((segment) => segment.dataset['segment'])).toEqual([
      'covered',
      'gap',
      'covered',
    ])
    expect(segments[0]?.style.left).toBe('0%')

    const efd = rendered.container.querySelector('[data-family="efd-icms-ipi"]')
    expect(efd?.querySelector('h3')?.textContent).toBe('EFD ICMS/IPI')
    expect(efd?.textContent).toContain('Nenhuma')
    expect(efd?.textContent).toContain('Federal')

    const unknown = rendered.container.querySelector('[data-family="nova-familia"]')
    expect(unknown?.querySelector('h3')?.textContent).toBe('nova-familia')
    expect(unknown?.textContent).toContain('Ainda sem cobertura')
    expect(unknown?.querySelector('[data-segment]')).toBeNull()
  })

  it('sem famílias, mostra o estado vazio', async () => {
    const api = installFakeApi()
    api.on('GET /api/v1/coverage', { corpusVersion: 0, families: [] })
    rendered = await renderClient(<CoverageView />)
    const title = await waitFor(() => byText('h2', 'Nenhuma fonte publicada'))
    expect(title).toBeDefined()
  })

  it('erro repetível mostra a mensagem e "tentar de novo" relê a cobertura', async () => {
    const api = installFakeApi()
    let failing = true
    api.on('GET /api/v1/coverage', () =>
      failing ? problem(429, 'rate_limited') : Response.json(COVERAGE),
    )
    rendered = await renderClient(<CoverageView />)
    const alert = await waitFor(() => rendered?.container.querySelector('[role="alert"]'))
    expect(alert.textContent).not.toBe('')

    failing = false
    await click(byText('button', 'Tentar de novo'))
    await waitFor(() => rendered?.container.querySelector('[data-family="rcte"]'))
    expect(api.calls.filter((call) => call.route === 'GET /api/v1/coverage')).toHaveLength(2)
  })

  it('erro definitivo não oferece repetir', async () => {
    const api = installFakeApi()
    api.on('GET /api/v1/coverage', () => problem(404, 'not_found'))
    rendered = await renderClient(<CoverageView />)
    await waitFor(() => rendered?.container.querySelector('[role="alert"]'))
    expect(byText('button', 'Tentar de novo')).toBeUndefined()
  })
})
