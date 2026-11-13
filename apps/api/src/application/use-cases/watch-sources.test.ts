import { describe, expect, it } from 'vitest'
import { type BlobStore, BlobStoreName } from '../ports/blob-store.ts'
import type { SafeFetcher, SafeFetchRequest, SafeFetchResponse } from '../ports/safe-fetcher.ts'
import type { DiscoveredReport } from '../ports/watch-report.ts'
import {
  type PageSignals,
  type WatchedItem,
  type WatchPage,
  WatchSignalError,
  type WatchSignalReader,
} from '../ports/watch-signals.ts'
import {
  DISCOVERED_KEY,
  resolvePageUrl,
  WATCH_STATE_KEY,
  WatchStateError,
  watchSources,
} from './watch-sources.ts'

const NOW = new Date('2026-11-11T12:00:00Z')
const clock = { now: () => new Date(NOW) }
const encoder = new TextEncoder()

class MemoryBlobs implements BlobStore {
  readonly data = new Map<string, Uint8Array>()
  writes = 0

  async get(store: BlobStoreName, key: string) {
    return this.data.get(`${store}/${key}`) ?? null
  }
  async set(store: BlobStoreName, key: string, value: Uint8Array | string) {
    this.writes += 1
    this.data.set(`${store}/${key}`, typeof value === 'string' ? encoder.encode(value) : value)
  }
  async list() {
    return [...this.data.keys()]
  }
  async delete(store: BlobStoreName, key: string) {
    this.data.delete(`${store}/${key}`)
  }
  json(key: string): unknown {
    const raw = this.data.get(`${BlobStoreName.CorpusManifests}/${key}`)
    return raw === undefined ? undefined : JSON.parse(new TextDecoder().decode(raw))
  }
}

type Responder = (request: SafeFetchRequest) => SafeFetchResponse | Promise<SafeFetchResponse>

class ScriptedFetcher implements SafeFetcher {
  readonly requests: SafeFetchRequest[] = []
  private readonly routes: Map<string, Responder>
  constructor(routes: Map<string, Responder>) {
    this.routes = routes
  }
  async fetch(request: SafeFetchRequest) {
    this.requests.push(request)
    const route = this.routes.get(request.url)
    if (route === undefined) {
      throw new Error(`rota inesperada ${request.url}`)
    }
    return route(request)
  }
}

/** O corpo das respostas de teste é o próprio `PageSignals` em JSON. */
const reader: WatchSignalReader = {
  read(_page, fetched) {
    const signals = JSON.parse(new TextDecoder().decode(fetched.body)) as PageSignals | string
    if (typeof signals === 'string') {
      throw new WatchSignalError(signals)
    }
    return signals
  },
}

function ok(url: string, signals: PageSignals | string, headers: Record<string, string> = {}) {
  return (): SafeFetchResponse => ({
    status: 200,
    url,
    headers,
    body: encoder.encode(JSON.stringify(signals)),
  })
}

function status(url: string, code: number): Responder {
  return () => ({ status: code, url, headers: {}, body: new Uint8Array() })
}

function signals(partial: Partial<PageSignals>): PageSignals {
  return { label: null, labelDate: null, labelNumber: null, items: [], ...partial }
}

function act(number: number, date: string | null): WatchedItem {
  const label = `Decreto nº ${String(number)}`
  return {
    key: String(number),
    url: `https://appasp.economia.go.gov.br/Decretos/D_${String(number)}.htm`,
    versionLabel: label,
    date,
    fingerprint: date ?? '',
    actNumber: number,
  }
}

const RCTE_URL = 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm'
const LIST_URL =
  'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/Decretos_Atualizadores.htm'
const DOCS_URL = 'https://www.gov.br/sped/efd'
const WS_URL = 'https://www.sped.fazenda.gov.br/ws'
const YEAR_URL = 'https://appasp.economia.go.gov.br/sumarios/Decretos_{yyyy}.htm'

const consolidated: WatchPage = {
  id: 'rcte-consolidado',
  family: 'rcte',
  kind: 'consolidated',
  url: RCTE_URL,
  mode: 'live',
  encoding: 'windows-1252',
}
const actList: WatchPage = {
  id: 'rcte-atualizadores',
  family: 'rcte',
  kind: 'act-list',
  act: 'decreto',
  include: null,
  exclude: null,
  url: LIST_URL,
  mode: 'live',
  encoding: 'windows-1252',
}
const documents: WatchPage = {
  id: 'sped-efd',
  family: 'efd-icms-ipi',
  kind: 'document-index',
  documents: [{ pattern: 'guia', versionPattern: null }],
  url: DOCS_URL,
  mode: 'pinned',
  encoding: 'utf-8',
}
const tables: WatchPage = {
  id: 'tabelas',
  family: 'tabelas-go',
  kind: 'tables-ws',
  tableIds: [37],
  url: WS_URL,
  mode: 'live',
  encoding: 'utf-8',
}
const yearly: WatchPage = {
  id: 'rcte-ano',
  family: 'rcte',
  kind: 'act-list',
  act: 'decreto',
  include: null,
  exclude: null,
  url: YEAR_URL,
  mode: 'live',
  encoding: 'windows-1252',
}

function header(number: number, date: string): PageSignals {
  return signals({
    label: `Decreto nº ${String(number)}`,
    labelDate: date,
    labelNumber: number,
  })
}

async function run(
  blobs: MemoryBlobs,
  routes: Array<[string, Responder]>,
  pages: readonly WatchPage[],
  options: { dryRun?: boolean; now?: Date } = {},
): Promise<{ report: DiscoveredReport; fetcher: ScriptedFetcher }> {
  const fetcher = new ScriptedFetcher(new Map(routes))
  const report = await watchSources(
    {
      fetcher,
      blobs,
      reader,
      clock: options.now === undefined ? clock : { now: () => options.now ?? NOW },
    },
    { pages, dryRun: options.dryRun === true },
  )
  return { report, fetcher }
}

describe('watchSources', () => {
  it('grava a linha de base na primeira observação, sem reportar mudança', async () => {
    const blobs = new MemoryBlobs()
    const { report, fetcher } = await run(
      blobs,
      [
        [RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'), { etag: '"a"' })],
        [LIST_URL, ok(LIST_URL, signals({ items: [act(10986, '2026-09-16')] }))],
      ],
      [consolidated, actList],
    )

    expect(report).toEqual({
      schemaVersion: 1,
      runDate: '2026-11-11',
      generatedAt: NOW.toISOString(),
      changes: [],
      errors: [],
      unverifiedFamilies: [],
    })
    expect(fetcher.requests.map((request) => request.headers)).toEqual([{}, {}])
    expect(fetcher.requests.every((request) => request.method === 'GET')).toBe(true)
    expect(blobs.json(WATCH_STATE_KEY)).toMatchObject({
      schemaVersion: 1,
      pages: {
        'rcte-consolidado': {
          url: RCTE_URL,
          etag: '"a"',
          lastModified: null,
          checkedOn: '2026-11-11',
          label: 'Decreto nº 10986',
          labelNumber: 10986,
        },
        'rcte-atualizadores': { items: { '10986': '2026-09-16' }, pending: [] },
      },
    })
    expect(blobs.json(DISCOVERED_KEY)).toEqual(report)
    expect(blobs.json('discovered/2026-11-11.json')).toEqual(report)
  })

  it('manda ETag e Last-Modified no GET condicional e mantém o estado em 304', async () => {
    const blobs = new MemoryBlobs()
    await run(
      blobs,
      [
        [
          RCTE_URL,
          ok(RCTE_URL, header(10986, '2026-09-16'), {
            etag: '"a"',
            'last-modified': 'Wed, 11 Nov 2026 18:22:24 GMT',
          }),
        ],
      ],
      [consolidated],
    )
    const later = new Date('2026-11-12T12:00:00Z')
    const { report, fetcher } = await run(
      blobs,
      [[RCTE_URL, status(RCTE_URL, 304)]],
      [consolidated],
      {
        now: later,
      },
    )

    expect(fetcher.requests[0]?.headers).toEqual({
      'if-none-match': '"a"',
      'if-modified-since': 'Wed, 11 Nov 2026 18:22:24 GMT',
    })
    expect(report.changes).toEqual([])
    expect(report.runDate).toBe('2026-11-12')
    expect(blobs.json(WATCH_STATE_KEY)).toMatchObject({
      pages: { 'rcte-consolidado': { etag: '"a"', checkedOn: '2026-11-12' } },
    })
  })

  it('reporta o consolidado com rótulo novo, a partir da data do rótulo', async () => {
    const blobs = new MemoryBlobs()
    await run(blobs, [[RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'))]], [consolidated])
    const { report } = await run(
      blobs,
      [[RCTE_URL, ok(RCTE_URL, header(10991, '2026-10-08'))]],
      [consolidated],
    )

    expect(report.changes).toEqual([
      {
        family: 'rcte',
        kind: 'consolidated',
        pageId: 'rcte-consolidado',
        mode: 'live',
        status: 'new',
        sourceUrl: RCTE_URL,
        effectiveFrom: '2026-10-08',
        versionLabel: 'Decreto nº 10991',
      },
    ])
  })

  it('leva para a mudança os documentos que resolvem a lacuna (covers do item ou da página)', async () => {
    const blobs = new MemoryBlobs()
    const page: WatchPage = { ...consolidated, covers: ['rcte'] }
    await run(blobs, [[RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'))]], [page])
    const { report } = await run(
      blobs,
      [[RCTE_URL, ok(RCTE_URL, header(10991, '2026-10-08'))]],
      [page],
    )
    expect(report.changes.map((item) => item.covers)).toEqual([['rcte']])

    const index: WatchPage = { ...documents, covers: ['pagina'] }
    const docBlobs = new MemoryBlobs()
    await run(docBlobs, [[DOCS_URL, ok(DOCS_URL, signals({ items: [] }))]], [index])
    const doc = (url: string): WatchedItem => ({
      key: url,
      url,
      versionLabel: null,
      date: null,
      fingerprint: '1',
      actNumber: null,
    })
    const guia = { ...doc('https://www.gov.br/sped/guia-3.pdf'), covers: ['guia'] }
    const nota = doc('https://www.gov.br/sped/nota.pdf')
    const second = await run(
      docBlobs,
      [[DOCS_URL, ok(DOCS_URL, signals({ items: [guia, nota] }))]],
      [index],
    )
    expect(second.report.changes.map((item) => [item.sourceUrl, item.covers])).toEqual([
      ['https://www.gov.br/sped/guia-3.pdf', ['guia']],
      ['https://www.gov.br/sped/nota.pdf', ['pagina']],
    ])
  })

  it('usa a data do run quando o rótulo novo não traz data', async () => {
    const blobs = new MemoryBlobs()
    await run(blobs, [[RCTE_URL, ok(RCTE_URL, header(1, '2026-01-01'))]], [consolidated])
    const { report } = await run(
      blobs,
      [[RCTE_URL, ok(RCTE_URL, signals({ label: 'Decreto nº 2', labelNumber: 2 }))]],
      [consolidated],
    )
    expect(report.changes[0]?.effectiveFrom).toBe('2026-11-11')
  })

  it('deixa pendente o ato novo até o consolidado alcançá-lo', async () => {
    const blobs = new MemoryBlobs()
    const base: Array<[string, Responder]> = [
      [RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'))],
      [LIST_URL, ok(LIST_URL, signals({ items: [act(10986, '2026-09-16')] }))],
    ]
    await run(blobs, base, [consolidated, actList])

    const withNewAct: Array<[string, Responder]> = [
      [RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'))],
      [LIST_URL, ok(LIST_URL, signals({ items: [act(10995, '2026-11-10'), act(10986, null)] }))],
    ]
    const first = await run(blobs, withNewAct, [consolidated, actList])
    expect(first.report.changes).toEqual([
      expect.objectContaining({
        kind: 'act',
        status: 'new',
        versionLabel: 'Decreto nº 10995',
        effectiveFrom: '2026-11-10',
      }),
    ])

    const second = await run(blobs, withNewAct, [consolidated, actList])
    expect(second.report.changes).toEqual([
      expect.objectContaining({ kind: 'act', status: 'pending', effectiveFrom: '2026-11-10' }),
    ])

    const third = await run(
      blobs,
      [
        [RCTE_URL, ok(RCTE_URL, header(10995, '2026-11-10'))],
        [LIST_URL, ok(LIST_URL, signals({ items: [act(10995, '2026-11-10')] }))],
      ],
      [consolidated, actList],
    )
    expect(third.report.changes).toEqual([
      expect.objectContaining({ kind: 'consolidated', versionLabel: 'Decreto nº 10995' }),
    ])
    expect(blobs.json(WATCH_STATE_KEY)).toMatchObject({
      pages: { 'rcte-atualizadores': { pending: [] } },
    })
  })

  it('não abre lacuna para ato que já entrou no consolidado no mesmo run', async () => {
    const blobs = new MemoryBlobs()
    await run(
      blobs,
      [
        [RCTE_URL, ok(RCTE_URL, header(10986, '2026-09-16'))],
        [LIST_URL, ok(LIST_URL, signals({ items: [] }))],
      ],
      [consolidated, actList],
    )
    const { report } = await run(
      blobs,
      [
        [RCTE_URL, ok(RCTE_URL, header(10991, '2026-10-08'))],
        [LIST_URL, ok(LIST_URL, signals({ items: [act(10991, '2026-10-08')] }))],
      ],
      [consolidated, actList],
    )
    expect(report.changes.map((item) => item.kind)).toEqual(['consolidated'])
  })

  it('sem página consolidada da família, o ato novo fica pendente', async () => {
    const blobs = new MemoryBlobs()
    await run(blobs, [[LIST_URL, ok(LIST_URL, signals({}))]], [actList])
    const noNumber = { ...act(1, null), actNumber: null, key: 'x' }
    const { report } = await run(
      blobs,
      [[LIST_URL, ok(LIST_URL, signals({ items: [act(5, null), noNumber] }))]],
      [actList],
    )
    expect(report.changes).toEqual([
      expect.objectContaining({ kind: 'act', status: 'new', effectiveFrom: '2026-11-11' }),
    ])
  })

  it('reporta documento novo e tabela com versão nova', async () => {
    const blobs = new MemoryBlobs()
    const doc = (key: string): WatchedItem => ({
      key,
      url: key,
      versionLabel: '3.2.4',
      date: null,
      fingerprint: '1',
      actNumber: null,
    })
    const table = (fingerprint: string): WatchedItem => ({
      key: '37',
      url: `${WS_URL}?idTabela=37`,
      versionLabel: 'versão 152',
      date: '2026-11-01',
      fingerprint,
      actNumber: null,
    })
    await run(
      blobs,
      [
        [DOCS_URL, ok(DOCS_URL, signals({ items: [doc('https://a/1.pdf')] }))],
        [WS_URL, ok(WS_URL, signals({ items: [table('151:AA')] }))],
      ],
      [documents, tables],
    )
    const { report } = await run(
      blobs,
      [
        [
          DOCS_URL,
          ok(DOCS_URL, signals({ items: [doc('https://a/1.pdf'), doc('https://a/2.pdf')] })),
        ],
        [WS_URL, ok(WS_URL, signals({ items: [table('152:BB')] }))],
      ],
      [documents, tables],
    )
    expect(report.changes).toEqual([
      {
        family: 'efd-icms-ipi',
        kind: 'document',
        pageId: 'sped-efd',
        mode: 'pinned',
        status: 'new',
        sourceUrl: 'https://a/2.pdf',
        effectiveFrom: '2026-11-11',
        versionLabel: '3.2.4',
      },
      expect.objectContaining({
        family: 'tabelas-go',
        kind: 'table',
        effectiveFrom: '2026-11-01',
        versionLabel: 'versão 152',
      }),
    ])
  })

  it('registra erros por página e deixa a família sem verificação', async () => {
    const blobs = new MemoryBlobs()
    const { report } = await run(
      blobs,
      [
        [RCTE_URL, () => Promise.reject(new Error('host bloqueado'))],
        [LIST_URL, status(LIST_URL, 500)],
        [DOCS_URL, ok(DOCS_URL, 'sinal ausente')],
        [WS_URL, () => Promise.reject('falha sem Error')],
      ],
      [consolidated, actList, documents, tables],
    )
    expect(report.errors).toEqual([
      { pageId: 'rcte-consolidado', family: 'rcte', message: 'host bloqueado' },
      { pageId: 'rcte-atualizadores', family: 'rcte', message: `HTTP 500 em ${LIST_URL}` },
      { pageId: 'sped-efd', family: 'efd-icms-ipi', message: 'sinal ausente' },
      { pageId: 'tabelas', family: 'tabelas-go', message: 'falha sem Error' },
    ])
    expect(report.unverifiedFamilies).toEqual(['efd-icms-ipi', 'rcte', 'tabelas-go'])
    expect(blobs.json(WATCH_STATE_KEY)).toEqual({ schemaVersion: 1, pages: {} })
  })

  it('trata 404 de URL com {yyyy} como página vazia e reinicia a base no ano novo', async () => {
    const blobs = new MemoryBlobs()
    const url2026 = resolvePageUrl(YEAR_URL, '2026-11-11')
    const url2027 = resolvePageUrl(YEAR_URL, '2027-01-02')
    expect(url2026).toBe('https://appasp.economia.go.gov.br/sumarios/Decretos_2026.htm')

    await run(blobs, [[url2026, ok(url2026, signals({ items: [] }))]], [yearly])
    const withAct = await run(
      blobs,
      [[url2026, ok(url2026, signals({ items: [act(11000, '2026-12-20')] }))]],
      [yearly],
    )
    expect(withAct.report.changes).toEqual([expect.objectContaining({ status: 'new' })])

    const january = new Date('2027-01-02T12:00:00Z')
    const first = await run(blobs, [[url2027, status(url2027, 404)]], [yearly], { now: january })
    expect(first.report.errors).toEqual([])
    expect(first.report.changes).toEqual([
      expect.objectContaining({ status: 'pending', versionLabel: 'Decreto nº 11000' }),
    ])
    expect(first.fetcher.requests[0]?.headers).toEqual({})

    const published = await run(
      blobs,
      [[url2027, ok(url2027, signals({ items: [act(11001, '2027-01-03')] }))]],
      [yearly],
      { now: new Date('2027-01-04T12:00:00Z') },
    )
    expect(published.report.changes.map((item) => [item.status, item.versionLabel])).toEqual([
      ['new', 'Decreto nº 11001'],
      ['pending', 'Decreto nº 11000'],
    ])
  })

  it('404 em URL fixa é erro', async () => {
    const blobs = new MemoryBlobs()
    const { report } = await run(blobs, [[RCTE_URL, status(RCTE_URL, 404)]], [consolidated])
    expect(report.errors[0]?.message).toBe(`HTTP 404 em ${RCTE_URL}`)
  })

  it('304 sem estado anterior da mesma URL é erro', async () => {
    const blobs = new MemoryBlobs()
    const { report } = await run(blobs, [[RCTE_URL, status(RCTE_URL, 304)]], [consolidated])
    expect(report.errors).toHaveLength(1)
  })

  it('em dry-run não grava nada no Blobs', async () => {
    const blobs = new MemoryBlobs()
    await run(blobs, [[RCTE_URL, ok(RCTE_URL, header(1, '2026-01-01'))]], [consolidated], {
      dryRun: true,
    })
    expect(blobs.writes).toBe(0)
  })

  it('recusa watch-state.json corrompido ou fora do schema', async () => {
    const corrupt = new MemoryBlobs()
    await corrupt.set(BlobStoreName.CorpusManifests, WATCH_STATE_KEY, '{')
    await expect(run(corrupt, [], [consolidated])).rejects.toBeInstanceOf(WatchStateError)

    const invalid = new MemoryBlobs()
    await invalid.set(BlobStoreName.CorpusManifests, WATCH_STATE_KEY, '{"schemaVersion":2}')
    await expect(run(invalid, [], [consolidated])).rejects.toThrow(/watch-state.json inválido/)
  })
})
