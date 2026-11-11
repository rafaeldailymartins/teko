import { describe, expect, it, vi } from 'vitest'
import type { Evidence } from '#domain/qa/evidence.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import type { SearchQuery } from '../ports/search-repository.ts'
import { createHybridSearch } from './hybrid-search.ts'

const VECTOR = [0.1, 0.2, 0.3]

const evidence: Evidence = {
  chunkId: 'c1',
  stableKey: 'go:rcte:art:76:par:6',
  family: 'rcte',
  citationLabel: 'RCTE, art. 76, § 6º',
  content: '§ 6º ...',
  validity: { from: '2004-11-04', to: '2009-11-23' },
  document: { versionId: 'v', versionLabel: 'RCTE 2026', title: 'RCTE', sourceUrl: 'https://x' },
  rrf: 0.04,
  lexicalRank: 1,
  semanticRank: 2,
  referenceRank: 1,
}

function embeddingsOf(embed: EmbeddingPort['embed']): EmbeddingPort {
  return { model: 'fake', dimensions: 3, embed }
}

function setup(embed: EmbeddingPort['embed'], timeoutMs = 3000) {
  const queries: SearchQuery[] = []
  const search = createHybridSearch({
    embeddings: embeddingsOf(embed),
    searchRepository: {
      search: (query) => {
        queries.push(query)
        return Promise.resolve([evidence])
      },
    },
    reviewStatuses: ['auto', 'approved'],
    embeddingTimeoutMs: timeoutMs,
    limit: 12,
  })
  return { search, queries }
}

const command = {
  question: 'O § 6º do art. 76 do RCTE valia em 2006?',
  referenceDate: '2006-05-01',
  families: ['rcte'],
}

describe('createHybridSearch', () => {
  it('embute a pergunta e busca com as referências citadas, os status e o limite', async () => {
    const embed = vi.fn<EmbeddingPort['embed']>(() => Promise.resolve([VECTOR]))
    const { search, queries } = setup(embed)
    await expect(search(command)).resolves.toEqual({
      mode: 'hybrid',
      evidence: [evidence],
      stableKeys: ['go:rcte:art:76:par:6', 'go:rcte:art:76'],
    })
    expect(embed).toHaveBeenCalledWith([command.question], { signal: expect.any(AbortSignal) })
    expect(queries).toEqual([
      {
        text: command.question,
        embedding: VECTOR,
        referenceDate: '2006-05-01',
        families: ['rcte'],
        stableKeys: ['go:rcte:art:76:par:6', 'go:rcte:art:76'],
        reviewStatuses: ['auto', 'approved'],
        limit: 12,
      },
    ])
  })

  it('sem famílias cobertas não embute nem busca', async () => {
    const embed = vi.fn<EmbeddingPort['embed']>()
    const { search, queries } = setup(embed)
    await expect(search({ ...command, families: [] })).resolves.toEqual({
      mode: 'hybrid',
      evidence: [],
      stableKeys: ['go:rcte:art:76:par:6', 'go:rcte:art:76'],
    })
    expect(embed).not.toHaveBeenCalled()
    expect(queries).toEqual([])
  })

  it('provedor indisponível degrada para lexical_only', async () => {
    const { search, queries } = setup(() =>
      Promise.reject(new EmbeddingUnavailableError('HTTP 503')),
    )
    await expect(search(command)).resolves.toMatchObject({ mode: 'lexical_only' })
    expect(queries[0]?.embedding).toBeNull()
  })

  it('resposta sem vetor também degrada', async () => {
    const { search } = setup(() => Promise.resolve([]))
    await expect(search(command)).resolves.toMatchObject({ mode: 'lexical_only' })
  })

  it('estouro do teto de tempo degrada para lexical_only', async () => {
    const { search } = setup(
      (_texts, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
      5,
    )
    await expect(search(command)).resolves.toMatchObject({ mode: 'lexical_only' })
  })

  it('cancelamento do cliente propaga (não é degradação)', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cliente saiu'))
    const { search, queries } = setup((_texts, options) =>
      Promise.reject(options?.signal?.reason ?? new Error('sem sinal')),
    )
    await expect(search({ ...command, signal: controller.signal })).rejects.toThrow('cliente saiu')
    expect(queries).toEqual([])
  })

  it('outros erros (ex.: miss do fake em modo strict) propagam', async () => {
    const { search } = setup(() => Promise.reject(new Error('fixture sem o vetor')))
    await expect(search(command)).rejects.toThrow('fixture sem o vetor')
  })

  it('com sinal do cliente ainda ativo, um erro do provedor degrada', async () => {
    const controller = new AbortController()
    const { search } = setup(() => Promise.reject(new EmbeddingUnavailableError('x')))
    await expect(search({ ...command, signal: controller.signal })).resolves.toMatchObject({
      mode: 'lexical_only',
    })
  })
})

describe('EmbeddingUnavailableError', () => {
  it('tem nome próprio e guarda a causa', () => {
    const cause = new Error('rede')
    const error = new EmbeddingUnavailableError('inacessível', { cause })
    expect(error.name).toBe('EmbeddingUnavailableError')
    expect(error.cause).toBe(cause)
    expect(new EmbeddingUnavailableError('x').cause).toBeUndefined()
  })
})
