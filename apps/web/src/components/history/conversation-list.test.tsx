// @vitest-environment happy-dom
import { createProblem, ErrorCode } from '@teko/shared/errors'
import type { AnchorHTMLAttributes } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api/client'
import { conversationsQuery } from '@/lib/api/queries'
import { createQueryClient } from '@/lib/api/query-client'
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
      `/pt-BR/chat/?c=${FIRST}`,
      `/pt-BR/chat/?c=${SECOND}`,
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

  it('vazio: estado vazio na página e uma frase no painel', async () => {
    rendered = await renderClient(<ConversationList variant="page" />, {
      client: seeded([{ items: [], nextCursor: null }]),
    })
    expect(rendered.container.querySelector('h2')?.textContent).toBe('Nenhuma conversa ainda')
    await rendered.unmount()
    rendered = await renderClient(<ConversationList variant="panel" />, {
      client: seeded([{ items: [], nextCursor: null }]),
    })
    expect(rendered.container.querySelector('h2')).toBeNull()
    expect(rendered.container.textContent).toContain('Suas conversas aparecem aqui')
  })

  it('sem sessão: a mensagem do erro e o caminho para entrar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(createProblem({ code: ErrorCode.Unauthenticated, traceId: 't' }), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        }),
      ),
    )
    rendered = await renderClient(<ConversationList variant="panel" />)
    expect(rendered.container.querySelector('[role="status"]')?.textContent).toContain(
      'Carregando as conversas',
    )
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
