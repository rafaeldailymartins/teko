import { describe, expect, it, vi } from 'vitest'
import type { Evidence } from '#domain/qa/evidence.ts'
import { type EmbeddingPort, EmbeddingUnavailableError } from '../ports/embedding-port.ts'
import { type RerankerPort, RerankerUnavailableError } from '../ports/reranker-port.ts'
import type { SearchQuery } from '../ports/search-repository.ts'
import { type TranslatorPort, TranslatorUnavailableError } from '../ports/translator-port.ts'
import { createHybridSearch } from './hybrid-search.ts'

const VECTOR = [0.1, 0.2, 0.3]

const evidence: Evidence = {
  chunkId: 'c1',
  stableKey: 'go:rcte:art:76:par:6',
  family: 'rcte',
  citationLabel: 'RCTE, art. 76, § 6º',
  headingPath: 'RCTE > Art. 76',
  ancestors: [],
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
      versionsInPeriod: () => Promise.resolve([]),
      search: (query) => {
        queries.push(query)
        return Promise.resolve([evidence])
      },
    },
    reviewStatuses: ['auto', 'approved'],
    embeddingTimeoutMs: timeoutMs,
    limit: 12,
    reranker: null,
    rerankCandidates: 30,
    rerankTimeoutMs: 2000,
    translator: null,
    translationTimeoutMs: 2000,
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
      reranked: false,
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
      reranked: false,
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

describe('createHybridSearch com reranker (ADR 0027)', () => {
  const candidate = (id: string, content: string): Evidence => ({
    ...evidence,
    chunkId: id,
    stableKey: `go:rcte:art:${id}`,
    citationLabel: `RCTE, art. ${id}`,
    headingPath: `RCTE > Art. ${id}`,
    ancestors: [],
    content,
  })
  const pool = [
    candidate('1', 'registro'),
    { ...candidate('2', 'campo'), ancestors: ['Registro C100'] },
    candidate('3', 'outro'),
  ]

  function withReranker(rerank: RerankerPort['rerank'], options: { limit?: number } = {}) {
    const queries: SearchQuery[] = []
    const search = createHybridSearch({
      embeddings: embeddingsOf(() => Promise.resolve([VECTOR])),
      searchRepository: {
        versionsInPeriod: () => Promise.resolve([]),
        search: (query) => {
          queries.push(query)
          return Promise.resolve(pool)
        },
      },
      reviewStatuses: ['auto', 'approved'],
      embeddingTimeoutMs: 3000,
      limit: options.limit ?? 2,
      reranker: { model: 'fake-reranker', rerank },
      rerankCandidates: 30,
      rerankTimeoutMs: 5,
      translator: null,
      translationTimeoutMs: 2000,
    })
    return { search, queries }
  }

  it('pede os candidatos do reranker, reordena pela nota e corta no limite', async () => {
    const rerank = vi.fn<RerankerPort['rerank']>(() => Promise.resolve([0.1, 0.9, 0.5]))
    const { search, queries } = withReranker(rerank)
    const result = await search(command)
    expect(queries[0]?.limit).toBe(30)
    expect(rerank).toHaveBeenCalledWith(
      command.question,
      ['RCTE > Art. 1\nregistro', 'RCTE > Art. 2\nRegistro C100\ncampo', 'RCTE > Art. 3\noutro'],
      { signal: expect.any(AbortSignal) },
    )
    expect(result.evidence.map((item) => item.chunkId)).toEqual(['2', '3'])
    expect(result.reranked).toBe(true)
  })

  it('empate de nota mantém a ordem do RRF', async () => {
    const { search } = withReranker(() => Promise.resolve([0.5, 0.5, 0.9]), { limit: 3 })
    expect((await search(command)).evidence.map((item) => item.chunkId)).toEqual(['3', '1', '2'])
  })

  it('reranker indisponível ou acima do teto mantém a ordem do RRF', async () => {
    const unavailable = withReranker(() => Promise.reject(new RerankerUnavailableError('HTTP 503')))
    await expect(unavailable.search(command)).resolves.toMatchObject({
      reranked: false,
      evidence: [pool[0], pool[1]],
    })
    const slow = withReranker(
      (_query, _texts, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
    )
    await expect(slow.search(command)).resolves.toMatchObject({ reranked: false })
  })

  it('cancelamento do cliente propaga e outros erros do reranker também', async () => {
    const controller = new AbortController()
    const { search } = withReranker(() => {
      controller.abort(new Error('cliente saiu'))
      return Promise.reject(controller.signal.reason)
    })
    await expect(search({ ...command, signal: controller.signal })).rejects.toThrow('cliente saiu')
    const buggy = withReranker(() => Promise.reject(new Error('bug')))
    await expect(buggy.search(command)).rejects.toThrow('bug')
  })

  it('com menos de dois candidatos não chama o reranker', async () => {
    const rerank = vi.fn<RerankerPort['rerank']>()
    const search = createHybridSearch({
      embeddings: embeddingsOf(() => Promise.resolve([VECTOR])),
      searchRepository: {
        search: () => Promise.resolve([evidence]),
        versionsInPeriod: () => Promise.resolve([]),
      },
      reviewStatuses: ['auto'],
      embeddingTimeoutMs: 3000,
      limit: 12,
      reranker: { model: 'fake-reranker', rerank },
      rerankCandidates: 30,
      rerankTimeoutMs: 2000,
      translator: null,
      translationTimeoutMs: 2000,
    })
    await expect(search(command)).resolves.toMatchObject({ reranked: false, evidence: [evidence] })
    expect(rerank).not.toHaveBeenCalled()
  })
})

describe('RerankerUnavailableError', () => {
  it('tem nome próprio e guarda a causa', () => {
    const cause = new Error('rede')
    const error = new RerankerUnavailableError('inacessível', { cause })
    expect(error.name).toBe('RerankerUnavailableError')
    expect(error.cause).toBe(cause)
  })
})

describe('createHybridSearch com tradutor (ADR 0034)', () => {
  function withTranslator(toPortuguese: TranslatorPort['toPortuguese'], timeoutMs = 2000) {
    const queries: SearchQuery[] = []
    const embedded: string[] = []
    const reranked: string[] = []
    const search = createHybridSearch({
      embeddings: embeddingsOf((texts) => {
        embedded.push(...texts)
        return Promise.resolve([VECTOR])
      }),
      searchRepository: {
        versionsInPeriod: () => Promise.resolve([]),
        search: (query) => {
          queries.push(query)
          return Promise.resolve([evidence, { ...evidence, chunkId: 'c2' }])
        },
      },
      reviewStatuses: ['auto', 'approved'],
      embeddingTimeoutMs: 3000,
      limit: 12,
      reranker: {
        model: 'fake-reranker',
        rerank: (query) => {
          reranked.push(query)
          return Promise.resolve([0.1, 0.2])
        },
      },
      rerankCandidates: 30,
      rerankTimeoutMs: 2000,
      translator: { model: 'fake-translator', toPortuguese },
      translationTimeoutMs: timeoutMs,
    })
    return { search, queries, embedded, reranked }
  }

  const english = {
    question: 'Was § 6 of art. 76 of the RCTE in force in 2006?',
    referenceDate: '2006-05-01',
    families: ['rcte'],
    locale: 'en' as const,
  }

  it('pergunta em inglês: os braços e o reranker usam a tradução; as referências vêm das duas', async () => {
    const toPortuguese = vi.fn<TranslatorPort['toPortuguese']>(() =>
      Promise.resolve('O § 6º do art. 76 do RCTE valia em 2006?'),
    )
    const { search, queries, embedded, reranked } = withTranslator(toPortuguese)
    const result = await search(english)
    expect(toPortuguese).toHaveBeenCalledWith(english.question, { signal: expect.any(AbortSignal) })
    expect(queries[0]?.text).toBe('O § 6º do art. 76 do RCTE valia em 2006?')
    expect(embedded).toEqual(['O § 6º do art. 76 do RCTE valia em 2006?'])
    expect(reranked).toEqual(['O § 6º do art. 76 do RCTE valia em 2006?'])
    expect(result.stableKeys).toEqual(['go:rcte:art:76', 'go:rcte:art:76:par:6'])
  })

  it('pergunta em português (ou sem idioma) não passa pelo tradutor', async () => {
    const toPortuguese = vi.fn<TranslatorPort['toPortuguese']>()
    const { search, queries } = withTranslator(toPortuguese)
    await search({ ...command, locale: 'pt-BR' })
    await search(command)
    expect(toPortuguese).not.toHaveBeenCalled()
    expect(queries.map((query) => query.text)).toEqual([command.question, command.question])
  })

  it('tradutor indisponível ou acima do teto: segue com a pergunta original', async () => {
    const unavailable = withTranslator(() =>
      Promise.reject(new TranslatorUnavailableError('fora do ar')),
    )
    await unavailable.search(english)
    expect(unavailable.queries[0]?.text).toBe(english.question)
    const slow = withTranslator(
      (_text, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason))
        }),
      5,
    )
    await slow.search(english)
    expect(slow.queries[0]?.text).toBe(english.question)
  })

  it('erro inesperado do tradutor propaga; cancelamento do cliente também', async () => {
    const broken = withTranslator(() => Promise.reject(new Error('bug')))
    await expect(broken.search(english)).rejects.toThrow('bug')
    const controller = new AbortController()
    const cancelled = withTranslator((_text, options) => {
      controller.abort(new Error('cliente saiu'))
      return Promise.reject(options?.signal?.reason)
    })
    await expect(cancelled.search({ ...english, signal: controller.signal })).rejects.toThrow(
      'cliente saiu',
    )
    expect(cancelled.queries).toEqual([])
  })
})
