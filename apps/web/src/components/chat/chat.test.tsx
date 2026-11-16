// @vitest-environment happy-dom
import { QueryClientProvider } from '@tanstack/react-query'
import { createProblem, ErrorCode } from '@teko/shared/errors'
import type { UIMessageChunk } from 'ai'
import { NextIntlClientProvider } from 'next-intl'
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { apiClient } from '@/lib/api/client'
import { ApiError } from '@/lib/api/errors'
import { createQueryClient } from '@/lib/api/query-client'
import { answerParts, partsToChunks } from '@/lib/chat/parts'
import ptBR from '../../../messages/pt-BR.json'
import { ANSWER, QUESTION_ID, questionDetail, RESOLVED_2008 } from '../../../test/chat-fixtures.ts'
import { ME } from '../../../test/fake-api.ts'
import { ChatWorkspace } from './chat-workspace.tsx'

/**
 * A conversa de ponta a ponta no DOM (happy-dom): o transporte é trocado por um falso que devolve
 * chunks do UI Message Stream (o transporte real tem teste próprio); `fetch` simulado responde a
 * cobertura, a cota, o feedback e a releitura da pergunta.
 */

interface SendOptions {
  readonly body?: object
  readonly abortSignal: AbortSignal | undefined
  readonly messages: readonly { parts: readonly { type: string; text?: string }[] }[]
}
type Scenario = (options: SendOptions) => ReadableStream<UIMessageChunk> | Promise<never>

const transport = vi.hoisted(() => ({
  scenarios: [] as Scenario[],
  calls: [] as { body: object | undefined; context: unknown; question: string }[],
}))

vi.mock('@/lib/api/chat-transport', () => ({
  TekoChatTransport: class {
    readonly options: { context: () => unknown }
    constructor(options: { context: () => unknown }) {
      this.options = options
    }
    async sendMessages(options: SendOptions) {
      const last = options.messages.at(-1)
      transport.calls.push({
        body: options.body,
        context: this.options.context(),
        question: last?.parts.map((part) => part.text ?? '').join('') ?? '',
      })
      const scenario = transport.scenarios.shift()
      if (scenario === undefined) throw new Error('sem cenário')
      return scenario(options)
    }
    async reconnectToStream() {
      return null
    }
  },
}))

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A primeira montagem carrega a conversa e o Streamdown por import() (lento no happy-dom).
vi.setConfig({ testTimeout: 30_000 })

const ORIGIN = 'http://teko.test'
const COVERAGE = {
  corpusVersion: 11,
  families: [
    {
      family: 'rcte',
      jurisdiction: 'GO',
      covered: [{ from: '1998-01-01', to: null }],
      verifiedAt: '2026-11-10',
    },
  ],
}

/** Redações do § 6º do art. 76 do RCTE, como na fixture da API. */
const VERSIONS = [
  {
    label: 'RCTE, art. 76, § 6º',
    validity: { from: '2003-09-12', to: '2004-11-04' },
    text: '§ 6º Excepcionalmente, para projeto de valor igual ou superior a R$ 300.000,00...',
    act: 'Decreto nº 5.825, de 05.09.03',
    fields: null,
  },
  {
    label: 'RCTE, art. 76, § 6º',
    validity: { from: '2004-11-04', to: '2009-11-23' },
    text: '§ 6º Observado o disposto no § 5º, quando o contribuinte aplicar 40.000,00...',
    act: null,
    fields: null,
  },
  {
    label: 'RCTE, art. 76, § 6º',
    validity: { from: '2009-11-23', to: null },
    text: '§ 6º Revogado.',
    act: 'Decreto nº 7.028',
    fields: null,
  },
]
const TIMELINE = {
  stableKey: 'go:rcte:art:76:par:6',
  family: 'rcte',
  jurisdiction: 'GO',
  versions: VERSIONS,
}
const DIFF = {
  stableKey: 'go:rcte:art:76:par:6',
  before: VERSIONS[0],
  after: VERSIONS[1],
  segments: [
    { op: 'equal', text: '§ 6º ' },
    { op: 'delete', text: 'R$ 300.000,00' },
    { op: 'insert', text: '40.000,00' },
  ],
  fieldChanges: [],
}

const fetchCalls: Request[] = []
let questionResponse: () => Response = () => new Response(null, { status: 404 })
let timelineResponse: () => Response = () => json(TIMELINE)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  })
}

function streamOf(chunks: readonly UIMessageChunk[]): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

/** Stream que só começa e fica aberto até o abort (botão Parar / Esc). */
function hangingStream({ abortSignal }: SendOptions): ReadableStream<UIMessageChunk> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'start', messageId: QUESTION_ID })
      controller.enqueue({ type: 'text-start', id: 't' })
      controller.enqueue({ type: 'text-delta', id: 't', delta: 'Gerando' })
      abortSignal?.addEventListener('abort', () =>
        controller.error(new DOMException('Aborted', 'AbortError')),
      )
    },
  })
}

const answered: Scenario = () =>
  streamOf(partsToChunks(answerParts(RESOLVED_2008, ANSWER), QUESTION_ID))

let container: HTMLDivElement
let root: Root
let urlUpdates: UrlUpdateEvent[]

async function render(ui: ReactNode, searchParams = ''): Promise<void> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR} timeZone="America/Sao_Paulo">
        <QueryClientProvider client={createQueryClient()}>
          <NuqsTestingAdapter
            searchParams={searchParams}
            onUrlUpdate={(event) => urlUpdates.push(event)}
          >
            <TooltipProvider>{ui}</TooltipProvider>
          </NuqsTestingAdapter>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    )
  })
}

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function waitFor<T>(find: () => T | null | undefined, timeout = 4000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const found = find()
    if (found !== null && found !== undefined && found !== false) return found
    if (Date.now() > deadline) {
      throw new Error(`tempo esgotado esperando: ${document.body.innerHTML.slice(0, 2000)}`)
    }
    await settle()
  }
}

/** Botão habilitado com o texto (sugestões e composer travam até a sessão carregar). */
function enabledButton(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].find(
    (element) => element.textContent?.includes(text),
  )
}

function byText(selector: string, text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) =>
    element.textContent?.includes(text),
  )
}

async function click(element: Element | null | undefined): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('elemento não encontrado')
  await act(async () => element.click())
  await settle()
}

async function type(text: string): Promise<HTMLTextAreaElement> {
  // O composer só destrava com a sessão pronta (`GET /me`); antes disso ele fica desabilitado.
  const textarea = await waitFor(() =>
    document.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)'),
  )
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return textarea
}

/** Pergunta pela sugestão de 05/2008, abre o chip S1 e devolve o painel da citação. */
async function openFirstCitation(): Promise<HTMLElement> {
  transport.scenarios.push(answered)
  await render(<ChatWorkspace />)
  await click(await waitFor(() => enabledButton('Perguntar em 05/2008')))
  await click(await waitFor(() => document.querySelector('button[data-citation-id="S1"]')))
  return waitFor(() => byText('article', 'Citação 1 de 2'))
}

async function press(init: KeyboardEventInit, target: EventTarget = document): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }))
  })
  await settle()
}

beforeAll(() => {
  apiClient.setConfig({ baseUrl: `${ORIGIN}/api` })
})

afterAll(() => {
  apiClient.setConfig({ baseUrl: '/api' })
})

beforeEach(() => {
  transport.scenarios.length = 0
  transport.calls.length = 0
  fetchCalls.length = 0
  urlUpdates = []
  questionResponse = () => new Response(null, { status: 404 })
  timelineResponse = () => json(TIMELINE)
  ;(
    window as unknown as { happyDOM: { setViewport(v: { width: number }): void } }
  ).happyDOM.setViewport({ width: 1280 })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      fetchCalls.push(request)
      const { pathname } = new URL(request.url)
      if (pathname === '/api/v1/coverage') return json(COVERAGE)
      // Sessão pronta (onboarding concluído): o composer só destrava com ela.
      if (pathname === '/api/v1/me') return json(ME)
      // Painel de histórico (ConversationList): sem conversas, para não somar um alerta de erro.
      if (pathname === '/api/v1/conversations') return json({ items: [], nextCursor: null })
      if (pathname === '/api/v1/me/quota') {
        return json({
          day: '2026-11-15',
          user: { used: 10, limit: 10 },
          global: { used: 10, limit: 100 },
          resetAt: '2099-01-01T03:00:00.000Z',
        })
      }
      // Painel de citação: linha do tempo do dispositivo e o diff (só no clique).
      if (pathname.endsWith('/timeline')) return timelineResponse()
      if (pathname.endsWith('/diff')) return json(DIFF)
      if (pathname.endsWith('/feedback')) return new Response(null, { status: 204 })
      if (pathname.startsWith('/api/v1/questions/')) return questionResponse()
      return new Response(null, { status: 404 })
    }),
  )
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('chat', () => {
  it('sugestão sensível à data: pergunta em 05/2008, resposta com data, vigência e chips', async () => {
    transport.scenarios.push(answered)
    await render(<ChatWorkspace />)
    await click(await waitFor(() => enabledButton('Perguntar em 05/2008')))

    expect(transport.calls[0]).toMatchObject({
      question: 'O que diz o art. 76, § 6º do RCTE?',
      context: { reference: { periodoApuracao: '2008-05', source: 'periodo_apuracao' } },
    })
    expect(urlUpdates.some((event) => event.queryString.includes('ref=2008-05'))).toBe(true)

    const header = await waitFor(() => document.querySelector('[data-reference-date]'))
    expect(header.getAttribute('data-reference-date')).toBe('2008-05-01')
    expect(header.textContent).toContain('Período de apuração 05/2008')
    expect(header.textContent).toContain('04/11/2004 a 22/11/2009')
    expect(document.querySelector('[data-message-role="user"]')?.textContent).toContain(
      'O que diz o art. 76',
    )
    await waitFor(() => document.querySelector('[data-answer-body] [data-citation-id="S1"]'))
    expect(document.querySelector('[data-testid="chat-live"]')?.textContent).toBe(
      'Resposta pronta.',
    )
    await waitFor(() => urlUpdates.find((event) => event.queryString.includes(`q=${QUESTION_ID}`)))
  })

  it('o chip abre o painel da citação, e ] e [ navegam entre as citações', async () => {
    const panel = await openFirstCitation()
    expect(panel.querySelector('h3')?.textContent).toBe('RCTE, art. 76, § 6º')
    expect(panel.querySelector('blockquote')?.getAttribute('lang')).toBe('pt-BR')
    expect(panel.querySelector('[data-validity]')?.getAttribute('data-validity')).toBe('superseded')
    expect(byText('a', 'Abrir o dispositivo')?.getAttribute('href')).toBe(
      '/pt-BR/provision/?k=go%3Arcte%3Aart%3A76%3Apar%3A6&ref=2008-05-01',
    )

    await press({ key: ']' })
    expect(byText('article', 'Citação 2 de 2')?.querySelector('h3')?.textContent).toBe(
      'RCTE, art. 76, § 5º',
    )
    await press({ key: '[' })
    await waitFor(() => byText('article', 'Citação 1 de 2'))

    await click(byText('button', 'Reportar citação errada'))
    await waitFor(() => byText('[role="status"]', 'a citação foi reportada'))
    const report = fetchCalls.find((request) => request.url.endsWith('/feedback'))
    expect(await report?.json()).toEqual({ rating: 'down', reason: 'wrong_citation' })
  })

  it('o painel mostra a linha do tempo na data da resposta e o diff só no clique', async () => {
    const panel = await openFirstCitation()
    const timeline = await waitFor(() =>
      panel.querySelector('ol[aria-label="Redações do dispositivo"]'),
    )
    expect(timeline.querySelectorAll('li')).toHaveLength(3)
    // Na data da resposta (01/05/2008) vale a redação de 04/11/2004 a 22/11/2009.
    expect(timeline.querySelector('[aria-current="true"]')?.textContent).toContain(
      '04/11/2004 a 22/11/2009',
    )
    expect(timeline.querySelectorAll('button')).toHaveLength(0)
    const timelineRequest = fetchCalls.find((request) => request.url.includes('/timeline'))
    expect(new URL(timelineRequest?.url ?? '').pathname).toBe(
      '/api/v1/provisions/go%3Arcte%3Aart%3A76%3Apar%3A6/timeline',
    )
    expect(fetchCalls.some((request) => request.url.includes('/diff'))).toBe(false)

    const toggle = await waitFor(() =>
      byText('button', 'Ver o que mudou em relação à redação anterior'),
    )
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    await click(toggle)
    await waitFor(() => panel.querySelector('ins'))
    expect(panel.querySelector('del')?.textContent).toContain('300.000,00')
    const diff = new URL(fetchCalls.find((request) => request.url.includes('/diff'))?.url ?? '')
    // A redação anterior (no primeiro dia dela) contra a vigente na data da resposta.
    expect(diff.searchParams.get('from')).toBe('2003-09-12')
    expect(diff.searchParams.get('to')).toBe('2008-05-01')
    expect(byText('button', 'Esconder as mudanças')?.getAttribute('aria-expanded')).toBe('true')

    // A citação seguinte é outro dispositivo: o diff aberto fecha.
    await press({ key: ']' })
    await waitFor(() => byText('article', 'Citação 2 de 2'))
    expect(byText('button', 'Esconder as mudanças')).toBeUndefined()
  })

  it('a linha do tempo do painel mostra o erro da API e tenta de novo', async () => {
    timelineResponse = () => json(createProblem({ code: ErrorCode.RateLimited, traceId: 't' }), 429)
    const panel = await openFirstCitation()
    const retry = await waitFor(() =>
      [...panel.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find((button) =>
        button.textContent?.includes('Tentar de novo'),
      ),
    )
    timelineResponse = () => json(TIMELINE)
    await click(retry)
    await waitFor(() => panel.querySelector('ol[aria-label="Redações do dispositivo"]'))
  })

  it('feedback 👍 grava a avaliação da resposta', async () => {
    transport.scenarios.push(answered)
    await render(<ChatWorkspace />)
    await click(await waitFor(() => enabledButton('Perguntar em 05/2008')))
    await click(await waitFor(() => document.querySelector('button[aria-label="Resposta útil"]')))
    await waitFor(() => byText('[role="status"]', 'Obrigado pelo retorno'))
    const feedback = fetchCalls.find((request) => request.url.endsWith('/feedback'))
    expect(new URL(feedback?.url ?? '').pathname).toBe(`/api/v1/questions/${QUESTION_ID}/feedback`)
  })

  it('avisa de PII antes de enviar e troca os dados pelos marcadores', async () => {
    transport.scenarios.push(answered)
    await render(<ChatWorkspace />)
    const textarea = await type('Meu CPF 529.982.247-25 precisa de EFD?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    const alert = await waitFor(() => byText('[role="alert"]', 'dados pessoais'))
    expect(alert.textContent).toContain('CPF')
    expect(transport.calls).toHaveLength(0)

    await click(byText('button', 'Remover os dados'))
    expect(textarea.value).toBe('Meu CPF [CPF] precisa de EFD?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    expect(transport.calls[0]?.question).toBe('Meu CPF [CPF] precisa de EFD?')
    expect(transport.calls[0]?.context).toMatchObject({ reference: { source: 'default' } })
  })

  it('needs_clarification mostra botões, e a escolha vai como clarified', async () => {
    transport.scenarios.push(
      () =>
        streamOf([
          { type: 'start' },
          {
            type: 'data-clarification',
            data: { reason: 'explicit_conflict', candidates: ['2008-05-01', '2010-01-01'] },
          },
          { type: 'finish' },
        ]),
      answered,
    )
    await render(<ChatWorkspace />)
    const textarea = await type('Em 01/2010, o que diz o art. 76, § 6º?')
    await press({ key: 'Enter', metaKey: true }, textarea)
    const candidate = await waitFor(() =>
      document.querySelector('button[data-candidate="2010-01-01"]'),
    )
    expect(byText('legend', 'Qual data vale')).toBeDefined()
    await click(candidate)
    expect(transport.calls[1]).toMatchObject({
      body: { clarifiedDate: '2010-01-01' },
      question: 'Em 01/2010, o que diz o art. 76, § 6º?',
    })
  })

  it('recusa mostra o motivo e a cobertura', async () => {
    transport.scenarios.push(() =>
      streamOf([
        { type: 'start', messageId: QUESTION_ID },
        { type: 'data-reference-date', data: { ...RESOLVED_2008, value: '1990-01-01' } },
        {
          type: 'data-refusal',
          data: { reason: 'out_of_coverage', coverage: COVERAGE.families },
        },
        { type: 'finish' },
      ]),
    )
    await render(<ChatWorkspace />)
    const textarea = await type('O que valia em 1990?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    const refusal = await waitFor(() => document.querySelector('[data-refusal="out_of_coverage"]'))
    expect(refusal.textContent).toContain('fora da cobertura')
    expect(refusal.textContent).toContain('Cobertura de rcte: desde 01/01/1998')
  })

  it('rótulos de degradação e cobertura parcial a partir de data-meta', async () => {
    transport.scenarios.push(() =>
      streamOf(
        partsToChunks(
          answerParts(
            { ...RESOLVED_2008, source: 'question_text' },
            {
              ...ANSWER,
              meta: {
                ...ANSWER.meta,
                retrievalMode: 'lexical_only',
                fallbackFrom: 'gemini',
                cached: true,
                uncoveredFamilies: ['efd-icms-ipi'],
              },
            },
          ),
          QUESTION_ID,
        ),
      ),
    )
    await render(<ChatWorkspace />)
    const textarea = await type('Em 05/2008, o que diz o art. 76?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    await waitFor(() => document.querySelector('[data-degraded="cached"]'))
    const labels = [...document.querySelectorAll('[data-degraded]')].map((item) => item.textContent)
    expect(labels).toEqual(['Somente busca lexical', 'Modelo de reserva', 'Resposta em cache'])
    expect(byText('[data-coverage="partial"]', 'efd-icms-ipi')).toBeDefined()

    // Data inferida do texto: fica âmbar e pede confirmação no composer.
    expect(
      document.querySelector('[data-reference-source="question_text"]')?.textContent,
    ).toContain('inferida do texto')
    await click(byText('button', 'Confirmar'))
    expect(urlUpdates.some((event) => event.queryString.includes('ref=2008-05'))).toBe(true)
  })

  it('cota estourada desabilita o composer e mostra o reset', async () => {
    transport.scenarios.push(() =>
      Promise.reject(
        new ApiError({
          code: ErrorCode.QuotaExceeded,
          status: 429,
          problem: createProblem({
            code: ErrorCode.QuotaExceeded,
            traceId: 't',
            meta: { scope: 'user_daily', resetAt: '2099-01-01T03:00:00.000Z' },
          }),
        }),
      ),
    )
    await render(<ChatWorkspace />)
    const textarea = await type('Qual o prazo do ICMS?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    const alert = await waitFor(() => byText('[role="alert"]', 'limite diário'))
    expect(alert.textContent).toContain('voltam em')
    expect(textarea.disabled).toBe(true)
  })

  it('erro repetível do stream mostra a mensagem, tenta de novo e relê a resposta', async () => {
    transport.scenarios.push(
      () => Promise.reject(new Error('{"code":"upstream_unavailable","retryable":true}')),
      () =>
        streamOf([
          { type: 'start', messageId: QUESTION_ID },
          { type: 'data-reference-date', data: RESOLVED_2008 },
          { type: 'error', errorText: '{"code":"internal","retryable":true}' },
        ]),
    )
    questionResponse = () => json(questionDetail())
    await render(<ChatWorkspace />)
    const textarea = await type('Qual o prazo do ICMS?')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    await waitFor(() => document.querySelector('[data-chat-error="upstream_unavailable"]'))
    expect(document.querySelector('[data-testid="chat-live"]')?.textContent).toBe(
      'A resposta falhou.',
    )

    await click(byText('button', 'Tentar de novo'))
    await waitFor(() => document.querySelector('[data-chat-error="internal"]'))
    await click(await waitFor(() => byText('button', 'Recarregar a resposta')))
    await waitFor(() => document.querySelector('[data-answer-body]'))
    expect(document.querySelector('[data-chat-error]')).toBeNull()
  })

  it('Esc para o stream e o botão Parar volta a ser Enviar', async () => {
    transport.scenarios.push(hangingStream)
    await render(<ChatWorkspace />)
    const textarea = await type('Pergunta longa')
    await press({ key: 'Enter', ctrlKey: true }, textarea)
    await waitFor(() => byText('button', 'Parar'))
    expect(document.querySelector('section[aria-busy="true"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="chat-live"]')?.textContent).toBe(
      'Gerando a resposta.',
    )
    await press({ key: 'Escape' })
    await waitFor(() => byText('button', 'Enviar'))
    expect(document.querySelector('[data-testid="chat-live"]')?.textContent).toBe(
      'Resposta interrompida.',
    )
  })

  it('/ foca o composer e Alt+D abre a data de referência; o mês escolhido vai para a URL', async () => {
    await render(<ChatWorkspace />)
    const textarea = await waitFor(() => document.querySelector('textarea'))
    await press({ key: '/' })
    expect(document.activeElement).toBe(textarea)

    await press({ key: 'd', code: 'KeyD', altKey: true })
    const dialog = await waitFor(() =>
      byText('[data-slot="popover-content"]', 'Data de referência'),
    )
    await click(document.querySelector('button[aria-label="Ano anterior"]'))
    await click(dialog.querySelector('button[data-periodo$="-03"]'))
    expect(urlUpdates.at(-1)?.queryString).toMatch(/ref=\d{4}-03/)
  })

  it('reaberto pelo Alt+D, o seletor volta ao ano da data escolhida', async () => {
    await render(<ChatWorkspace />)
    await waitFor(() => document.querySelector('textarea:not(:disabled)'))
    const openPicker = async () => {
      await press({ key: 'd', code: 'KeyD', altKey: true })
      return waitFor(() => byText('[data-slot="popover-content"]', 'Data de referência'))
    }
    const shownYear = (dialog: HTMLElement) =>
      dialog.querySelector('[aria-live="polite"]')?.textContent ?? ''

    let dialog = await openPicker()
    const chosenYear = shownYear(dialog)
    await click(dialog.querySelector('button[aria-label="Ano anterior"]'))
    expect(shownYear(dialog)).toBe(String(Number(chosenYear) - 1))
    await press({ key: 'Escape' })
    await waitFor(() => !byText('[data-slot="popover-content"]', 'Data de referência'))

    dialog = await openPicker()
    expect(shownYear(dialog)).toBe(chosenYear)
  })

  it('o seletor alterna para data exata e tem atalhos', async () => {
    await render(<ChatWorkspace />, '?ref=2024-03')
    const chip = await waitFor(() => document.querySelector('[data-reference-chip]'))
    expect(chip.textContent).toContain('Período de apuração: 03/2024')
    await click(chip)
    await click(byText('button', 'Data exata'))
    const input = document.querySelector<HTMLInputElement>('input[type="date"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(input, '2010-01-15')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(byText('button', 'Aplicar'))
    expect(urlUpdates.at(-1)?.queryString).toContain('ref=2010-01-15')

    await click(document.querySelector('[data-reference-chip]'))
    await click(byText('button', 'Voltar ao padrão'))
    expect(urlUpdates.at(-1)?.queryString).not.toContain('ref=')
  })

  it('relê a pergunta da URL (q) ao abrir', async () => {
    questionResponse = () => json(questionDetail())
    await render(<ChatWorkspace />, `?q=${QUESTION_ID}`)
    const header = await waitFor(() => document.querySelector('[data-reference-date]'))
    expect(header.getAttribute('data-reference-date')).toBe('2008-05-01')
    expect(document.querySelector('[data-message-role="user"]')?.textContent).toContain('art. 76')
  })

  it('mostra a cobertura da data no composer', async () => {
    await render(<ChatWorkspace />, '?ref=1990-01')
    await waitFor(() => document.querySelector('[data-coverage="out"]'))
    expect(byText('[role="note"]', 'Nenhuma fonte')).toBeDefined()
  })
})
