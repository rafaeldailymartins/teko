import { type QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  useCoverage,
  useHistory,
  useMe,
  useProvisionDiff,
  useProvisionSearch,
  useProvisionTimeline,
  useQuestion,
  useQuota,
} from './hooks.ts'
import {
  coverageQuery,
  historyQuery,
  meQuery,
  provisionDiffQuery,
  provisionSearchQuery,
  provisionTimelineQuery,
  questionQuery,
  quotaQuery,
} from './queries.ts'
import { createQueryClient } from './query-client.ts'

/**
 * Os hooks rodam num render de servidor (sem DOM e sem rede): o cache já semeado pelas keys de
 * `queries.ts` prova que cada hook lê a mesma entrada que as options; parâmetro `null` deixa a
 * consulta parada (`pending`, sem dado).
 */

const ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b'
const KEY = 'rcte:art-76'
const MARCH = { periodoApuracao: '2024-03' } as const
const NEXT_YEAR = { referenceDate: '2025-03-15' } as const

/** Key sem a marca de tipo das options: os testes semeiam só os campos que conferem. */
function put(client: QueryClient, key: QueryKey, data: unknown): void {
  client.setQueryData(key, data)
}

function seed(client: QueryClient): void {
  put(client, meQuery().queryKey, { name: 'Ana' })
  put(client, coverageQuery().queryKey, { corpusVersion: 7 })
  put(client, historyQuery(ID).queryKey, { items: [] })
  put(client, questionQuery(ID).queryKey, { status: 'answered' })
  put(client, quotaQuery().queryKey, { day: '2026-11-15' })
  put(client, provisionTimelineQuery(KEY).queryKey, { versions: [] })
  put(client, provisionDiffQuery(KEY, MARCH, NEXT_YEAR).queryKey, { segments: [] })
  put(client, provisionSearchQuery('art. 76', MARCH).queryKey, { at: '2024-03-01' })
}

function Probe({
  id,
  stableKey,
}: {
  readonly id: string | null
  readonly stableKey: string | null
}) {
  const results = {
    me: useMe(),
    coverage: useCoverage(),
    history: useHistory(id),
    question: useQuestion(id),
    quota: useQuota(id !== null),
    timeline: useProvisionTimeline(stableKey),
    diff: useProvisionDiff(stableKey, MARCH, NEXT_YEAR),
    search: useProvisionSearch(stableKey === null ? '' : 'art. 76', MARCH),
  }
  const summary = Object.fromEntries(
    Object.entries(results).map(([name, result]) => [name, [result.status, result.data ?? null]]),
  )
  return <pre>{JSON.stringify(summary)}</pre>
}

function render(id: string | null, stableKey: string | null): Record<string, [string, unknown]> {
  const client = createQueryClient()
  seed(client)
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe id={id} stableKey={stableKey} />
    </QueryClientProvider>,
  )
  const text = html.replace(/^<pre>|<\/pre>$/g, '').replaceAll('&quot;', '"')
  return JSON.parse(text) as Record<string, [string, unknown]>
}

describe('hooks da API', () => {
  it('leem o cache pelas mesmas keys das options', () => {
    expect(render(ID, KEY)).toEqual({
      me: ['success', { name: 'Ana' }],
      coverage: ['success', { corpusVersion: 7 }],
      history: ['success', { items: [] }],
      question: ['success', { status: 'answered' }],
      quota: ['success', { day: '2026-11-15' }],
      timeline: ['success', { versions: [] }],
      diff: ['success', { segments: [] }],
      search: ['success', { at: '2024-03-01' }],
    })
  })

  it('ficam parados quando falta o parâmetro', () => {
    const summary = render(null, null)
    for (const name of ['history', 'question', 'timeline', 'diff', 'search']) {
      expect(summary[name], name).toEqual(['pending', null])
    }
  })
})
