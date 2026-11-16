// @vitest-environment happy-dom
import { createProblem, ErrorCode } from '@teko/shared/errors'
import type { AnchorHTMLAttributes } from 'react'
import { act } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api/client'
import { conversationsQuery } from '@/lib/api/queries'
import { createQueryClient } from '@/lib/api/query-client'
import { newConversationHref } from '@/lib/url-state'
import { byText, click, type Rendered, renderClient, settle } from '../../../test/render.tsx'
import { ConversationList } from './conversation-list.tsx'

// O `next/link` do App Router exige o roteador montado; aqui basta o `<a>`.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const FIRST = '0193a3b0-7c1e-7b3a-9f00-000000000001'
const SECOND = '0193a3b0-7c1e-7b3a-9f00-000000000002'
const THIRD = '0193a3b0-7c1e-7b3a-9f00-000000000003'

function conversation(id: string, title: string, questionCount = 1) {
  return {
    conversationId: id,
    title,
    questionCount,
    updatedAt: '2026-11-10T15:00:00.000Z',
    lastReferenceDate: '2008-05-01',
  }
}

type Page = { items: ReturnType<typeof conversation>[]; nextCursor: string | null }

function seeded(pages: Page[]) {
  const client = createQueryClient()
  client.setQueryData(conversationsQuery().queryKey, {
    pages,
    pageParams: pages.map((_, index) => (index === 0 ? {} : `cursor_${index + 1}`)),
  })
  return client
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

describe('ConversationList', () => {
  it('no painel: links para o chat, a conversa aberta marcada e o resumo de cada uma', async () => {
    rendered = await renderClient(<ConversationList variant="panel" />, {
      searchParams: `?c=${SECOND}`,
      client: seeded([
        {
          items: [conversation(FIRST, 'Prazo do ICMS', 2), conversation(SECOND, 'GOYAZES')],
          nextCursor: 'cursor_2',
        },
      ]),
    })
    const links = [...rendered.container.querySelectorAll('nav a')]
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/pt-BR/chat/?c=${FIRST}&ref=2008-05`,
      `/pt-BR/chat/?c=${SECOND}&ref=2008-05`,
      '/pt-BR/history/',
    ])
    expect(links[1]?.getAttribute('aria-current')).toBe('page')
    expect(links[0]?.hasAttribute('aria-current')).toBe(false)
    expect(links[0]?.textContent).toContain('Ref. 05/2008')
    expect(links[0]?.textContent).toContain('2 perguntas')
    expect(links[1]?.textContent).toContain('1 pergunta')
    expect(links[2]?.textContent).toBe('Ver todo o histórico')
  })

  it('na página: "Carregar mais" busca a próxima página pelo cursor', async () => {
    const requests: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(new URL(request.url).search)
        return Response.json({ items: [conversation(THIRD, 'Terceira')], nextCursor: null })
      }),
    )
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items: [conversation(FIRST, 'Primeira')], nextCursor: 'cursor_2' }]),
    })
    await click(byText('button', 'Carregar mais'))
    await settle()
    expect(requests).toEqual(['?cursor=cursor_2'])
    const titles = [...rendered.container.querySelectorAll('nav li a > span:first-child')].map(
      (span) => span.textContent,
    )
    expect(titles).toEqual(['Primeira', 'Terceira'])
    expect(byText('button', 'Carregar mais')).toBeUndefined()
    expect(rendered.container.textContent).toContain('90 dias')
  })

  it('na página: grupos por dia e busca pelo título, sem acento nem caixa', async () => {
    const items = [
      conversation(FIRST, 'Crédito de ICMS na EFD'),
      conversation(SECOND, 'RCTE art. 76, § 6º'),
      conversation(THIRD, 'Prazo do ICMS'),
      conversation('0193a3b0-7c1e-7b3a-9f00-000000000004', 'Evento R-4020 da Reinf'),
    ]
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items, nextCursor: null }]),
    })
    const { container } = rendered
    // As quatro são de 10/11/2026, antes da semana de hoje: um grupo só.
    expect(container.querySelectorAll('nav section')).toHaveLength(1)
    expect(container.querySelector('nav section h2')?.textContent).toBeTruthy()

    const search = container.querySelector<HTMLInputElement>('input[type="search"]')
    if (search === null) throw new Error('busca ausente')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(search, 'credito efd')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const titles = [...container.querySelectorAll('nav li a > span:first-child')].map(
      (span) => span.textContent,
    )
    expect(titles).toEqual(['Crédito de ICMS na EFD'])

    await act(async () => {
      setter?.call(search, 'reinf ecd')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelector('nav [role="status"]')?.textContent).toContain('reinf ecd')
  })

  it('vazio: estado vazio na página e o título no painel', async () => {
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items: [], nextCursor: null }]),
    })
    expect(rendered.container.querySelector('h2')?.textContent).toBe('Nenhuma conversa ainda')
    await rendered.unmount()
    rendered = await renderClient(<ConversationList variant="panel" />, {
      client: seeded([{ items: [], nextCursor: null }]),
    })
    expect(rendered.container.querySelector('h2')).toBeNull()
    expect(rendered.container.textContent).toContain('Nenhuma conversa ainda')
  })

  it('sem sessão: a mensagem do erro e o caminho para entrar', async () => {
    // A resposta só sai depois de conferido o estado de carregamento (sem corrida com o fetch).
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate
        return Response.json(createProblem({ code: ErrorCode.Unauthenticated, traceId: 't' }), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        })
      }),
    )
    rendered = await renderClient(<ConversationList variant="panel" />)
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      'Carregando as conversas',
    )
    release()
    await settle(50)
    const alert = rendered.container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('Sua sessão expirou')
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/pt-BR/sign-in/')
  })

  it('erro transitório: mensagem genérica e nova tentativa', async () => {
    let calls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        return calls === 1
          ? Response.json(createProblem({ code: ErrorCode.Forbidden, traceId: 't' }), {
              status: 403,
              headers: { 'content-type': 'application/problem+json' },
            })
          : Response.json({ items: [conversation(FIRST, 'Depois')], nextCursor: null })
      }),
    )
    rendered = await renderClient(<ConversationList variant="page" />)
    await settle(50)
    expect(rendered.container.querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar o histórico.',
    )
    await click(byText('button', 'Tentar de novo'))
    await settle(50)
    expect(rendered.container.textContent).toContain('Depois')
  })
})

describe('excluir uma conversa', () => {
  /** `fetch` da exclusão: guarda método e caminho e responde com `respond`. */
  function deletions(respond: () => Response) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        calls.push(`${request.method} ${new URL(request.url).pathname}`)
        return request.method === 'DELETE'
          ? respond()
          : Response.json({ items: [conversation(FIRST, 'Prazo do ICMS')], nextCursor: null })
      }),
    )
    return calls
  }

  const titles = () =>
    [...document.querySelectorAll('nav li a > span:first-child')].map((span) => span.textContent)

  /** Abre o "⋯" da conversa e escolhe "Excluir conversa"; devolve o diálogo. */
  async function openDeletion(title: string): Promise<HTMLElement> {
    const trigger = document.querySelector<HTMLElement>(
      `button[aria-label="Ações da conversa “${title}”"]`,
    )
    await click(trigger)
    await click(byText('[role="menuitem"]', 'Excluir conversa'))
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
    if (dialog === null) throw new Error('diálogo ausente')
    return dialog
  }

  it('pela lista: confirma, a conversa some, o aviso aparece e a rota não muda', async () => {
    const calls = deletions(() => new Response(null, { status: 204 }))
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([
        {
          items: [conversation(FIRST, 'Prazo do ICMS'), conversation(SECOND, 'GOYAZES')],
          nextCursor: null,
        },
      ]),
    })
    const dialog = await openDeletion('GOYAZES')
    expect(dialog.textContent).toContain('Excluir esta conversa?')
    expect(dialog.textContent).toContain('“GOYAZES”')
    expect(dialog.textContent).toContain('Não dá para desfazer')
    expect(dialog.textContent).not.toContain('cota')

    await click(byText('[role="alertdialog"] button', 'Excluir conversa'))
    await settle(50)
    expect(calls).toContain(`DELETE /api/v1/conversations/${SECOND}`)
    expect(titles()).toEqual(['Prazo do ICMS'])
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Conversa excluída.')
    expect(rendered.urls).toEqual([])
  })

  it('cancelar não apaga nada', async () => {
    const calls = deletions(() => new Response(null, { status: 204 }))
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items: [conversation(FIRST, 'Prazo do ICMS')], nextCursor: null }]),
    })
    await openDeletion('Prazo do ICMS')
    await click(byText('[role="alertdialog"] button', 'Cancelar'))
    await settle(50)
    expect(calls.some((call) => call.startsWith('DELETE'))).toBe(false)
    expect(titles()).toEqual(['Prazo do ICMS'])
  })

  it('a conversa aberta: depois de excluir, volta ao chat vazio com a mesma data', async () => {
    deletions(() => new Response(null, { status: 204 }))
    rendered = await renderClient(<ConversationList variant="panel" />, {
      searchParams: `?c=${SECOND}&ref=2008-05`,
      client: seeded([
        {
          items: [conversation(FIRST, 'Prazo do ICMS'), conversation(SECOND, 'GOYAZES')],
          nextCursor: null,
        },
      ]),
    })
    await openDeletion('GOYAZES')
    await click(byText('[role="alertdialog"] button', 'Excluir conversa'))
    await settle(50)
    // A mesma URL do "Nova conversa" (`newConversationHref`), com a data mantida.
    const expected = newConversationHref('pt-BR', { periodoApuracao: '2008-05' })
    expect(expected).toBe('/pt-BR/chat/?ref=2008-05')
    expect(rendered.urls.at(-1)).toBe(expected.slice('/pt-BR/chat/'.length))
  })

  it('resposta em andamento (409): explica, mantém o diálogo e a conversa', async () => {
    deletions(() =>
      Response.json(createProblem({ code: ErrorCode.StreamBusy, traceId: 't' }), {
        status: 409,
        headers: { 'content-type': 'application/problem+json' },
      }),
    )
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items: [conversation(FIRST, 'Prazo do ICMS')], nextCursor: null }]),
    })
    await openDeletion('Prazo do ICMS')
    await click(byText('[role="alertdialog"] button', 'Excluir conversa'))
    await settle(50)
    const alert = document.querySelector('[role="alertdialog"] [role="alert"]')
    expect(alert?.textContent).toContain('ainda está sendo gerada')
    expect(titles()).toEqual(['Prazo do ICMS'])
  })
})
