import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { SearchQuery } from '#app/ports/search-repository.ts'
import { HNSW_SETTINGS, HYBRID_SEARCH_SQL, LEXICAL_ONLY_SQL } from '../sql/hybrid-search.ts'
import { createPgSearchRepository, searchParameters, toEvidence } from './pg-search-repository.ts'

const row = {
  id: 'c1',
  stable_key: 'go:rcte:art:76:par:6',
  family: 'rcte',
  content: '§ 6º ...',
  citation_label: 'RCTE, art. 76, § 6º',
  valid_from: '2004-11-04',
  valid_to: '2009-11-23',
  version_label: 'RCTE 2026',
  doc_version_id: 'dv1',
  doc_title: 'RCTE',
  source_url: 'https://x',
  rrf: 0.049,
  lex_rank: '1',
  sem_rank: null,
  ref_rank: '2',
}

const query: SearchQuery = {
  text: 'pergunta',
  embedding: [0.5, 0.25],
  referenceDate: '2006-05-01',
  families: ['rcte'],
  stableKeys: ['go:rcte:art:76'],
  reviewStatuses: ['auto', 'approved'],
  limit: 12,
}

function fakePool(fail = false) {
  const statements: string[] = []
  const release = vi.fn()
  const client = {
    query: (text: string, values?: unknown[]) => {
      statements.push(values === undefined ? text : `SQL(${String(values.length)})`)
      if (fail && values !== undefined) {
        return Promise.reject(new Error('statement timeout'))
      }
      return Promise.resolve({ rows: values === undefined ? [] : [row] })
    },
    release,
  }
  return {
    pool: { connect: () => Promise.resolve(client) } as unknown as pg.Pool,
    statements,
    release,
  }
}

describe('toEvidence e searchParameters', () => {
  it('converte a linha, com datas do pg e ranks nulos', () => {
    expect(toEvidence(row)).toEqual({
      chunkId: 'c1',
      stableKey: 'go:rcte:art:76:par:6',
      family: 'rcte',
      citationLabel: 'RCTE, art. 76, § 6º',
      content: '§ 6º ...',
      validity: { from: '2004-11-04', to: '2009-11-23' },
      document: {
        versionId: 'dv1',
        versionLabel: 'RCTE 2026',
        title: 'RCTE',
        sourceUrl: 'https://x',
      },
      rrf: 0.049,
      lexicalRank: 1,
      semanticRank: null,
      referenceRank: 2,
    })
    const fromDates = toEvidence({
      ...row,
      valid_from: new Date('2004-11-04T00:00:00Z') as unknown as string,
      valid_to: null,
    })
    expect(fromDates.validity).toEqual({ from: '2004-11-04', to: null })
  })

  it('posiciona os parâmetros e serializa o vetor', () => {
    expect(searchParameters(query)).toEqual([
      'pergunta',
      '[0.5,0.25]',
      '2006-05-01',
      ['rcte'],
      ['go:rcte:art:76'],
      ['auto', 'approved'],
      12,
    ])
    expect(searchParameters({ ...query, embedding: null })[1]).toBeNull()
  })
})

describe('createPgSearchRepository', () => {
  it('modo híbrido: transação só leitura com os SET LOCAL do HNSW', async () => {
    const { pool, statements, release } = fakePool()
    await expect(createPgSearchRepository(pool).search(query)).resolves.toHaveLength(1)
    expect(statements).toEqual(['BEGIN READ ONLY', ...HNSW_SETTINGS, 'SQL(7)', 'COMMIT'])
    expect(release).toHaveBeenCalledOnce()
    expect(HYBRID_SEARCH_SQL).not.toBe(LEXICAL_ONLY_SQL)
  })

  it('lexical_only: sem SET LOCAL do HNSW', async () => {
    const { pool, statements } = fakePool()
    await createPgSearchRepository(pool).search({ ...query, embedding: null })
    expect(statements).toEqual(['BEGIN READ ONLY', 'SQL(7)', 'COMMIT'])
  })

  it('erro: ROLLBACK, libera a conexão e propaga', async () => {
    const { pool, statements, release } = fakePool(true)
    await expect(createPgSearchRepository(pool).search(query)).rejects.toThrow('statement timeout')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
  })
})
