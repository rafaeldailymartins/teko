import type pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { SearchQuery } from '#app/ports/search-repository.ts'
import {
  BEGIN_HYBRID_SEARCH,
  HNSW_SETTINGS_SQL,
  HYBRID_SEARCH_SQL,
  LEXICAL_ONLY_SQL,
  PERIOD_VERSIONS_SQL,
} from '../sql/hybrid-search.ts'
import {
  createPgSearchRepository,
  periodVersionsParameters,
  searchParameters,
  toEvidence,
} from './pg-search-repository.ts'

const row = {
  id: 'c1',
  stable_key: 'go:rcte:art:76:par:6',
  family: 'rcte',
  content: '§ 6º ...',
  citation_label: 'RCTE, art. 76, § 6º',
  heading_path: 'RCTE > Art. 76 > § 6º',
  ancestors: ['Art. 76. Nas situações especiais …'],
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

/** `failures`: erro da busca em cada tentativa (`undefined` = sucesso); `true` = sempre falha. */
function fakePool(failures: boolean | readonly (Error | undefined)[] = false) {
  const statements: string[] = []
  const release = vi.fn()
  let attempt = 0
  const client = {
    query: (text: string, values?: unknown[]) => {
      statements.push(values === undefined ? text : `SQL(${String(values.length)})`)
      if (values !== undefined) {
        const failure =
          failures === true
            ? new Error('statement timeout')
            : failures === false
              ? undefined
              : failures[attempt]
        attempt += 1
        if (failure !== undefined) {
          return Promise.reject(failure)
        }
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

const terminated = () =>
  Object.assign(new Error('terminating connection due to administrator command'), {
    code: '57P01',
  })

describe('toEvidence e searchParameters', () => {
  it('converte a linha, com as datas em texto e ranks nulos', () => {
    expect(toEvidence(row)).toEqual({
      chunkId: 'c1',
      stableKey: 'go:rcte:art:76:par:6',
      family: 'rcte',
      citationLabel: 'RCTE, art. 76, § 6º',
      content: '§ 6º ...',
      headingPath: 'RCTE > Art. 76 > § 6º',
      ancestors: ['Art. 76. Nas situações especiais …'],
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
    expect(toEvidence({ ...row, valid_to: null }).validity).toEqual({
      from: '2004-11-04',
      to: null,
    })
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
  it('modo híbrido: três idas ao banco, com os ajustes do HNSW junto do BEGIN', async () => {
    const { pool, statements, release } = fakePool()
    await expect(createPgSearchRepository(pool).search(query)).resolves.toHaveLength(1)
    expect(statements).toEqual([BEGIN_HYBRID_SEARCH, 'SQL(7)', 'COMMIT'])
    expect(BEGIN_HYBRID_SEARCH).toBe(`BEGIN READ ONLY; ${HNSW_SETTINGS_SQL}`)
    expect(release).toHaveBeenCalledOnce()
    expect(HYBRID_SEARCH_SQL).not.toBe(LEXICAL_ONLY_SQL)
  })

  it('lexical_only: sem os ajustes do HNSW', async () => {
    const { pool, statements } = fakePool()
    await createPgSearchRepository(pool).search({ ...query, embedding: null })
    expect(statements).toEqual(['BEGIN READ ONLY', 'SQL(7)', 'COMMIT'])
  })

  it('erro: ROLLBACK, libera a conexão e propaga', async () => {
    const { pool, statements, release } = fakePool(true)
    await expect(createPgSearchRepository(pool).search(query)).rejects.toThrow('statement timeout')
    expect(statements.at(-1)).toBe('ROLLBACK')
    expect(release).toHaveBeenCalledOnce()
    expect(release).toHaveBeenCalledWith(undefined)
  })

  it('conexão derrubada (57P01): descarta a conexão e repete a busca uma vez', async () => {
    const { pool, statements, release } = fakePool([terminated(), undefined])
    await expect(createPgSearchRepository(pool).search(query)).resolves.toHaveLength(1)
    expect(statements).toEqual([
      BEGIN_HYBRID_SEARCH,
      'SQL(7)',
      'ROLLBACK',
      BEGIN_HYBRID_SEARCH,
      'SQL(7)',
      'COMMIT',
    ])
    expect(release).toHaveBeenCalledTimes(2)
    expect(release.mock.calls[0]?.[0]).toMatchObject({ code: '57P01' })
    expect(release.mock.calls[1]?.[0]).toBeUndefined()
  })

  it('versionsInPeriod: parâmetros posicionais, datas em texto e sem consulta quando vazio', async () => {
    const poolQuery = vi
      .fn()
      .mockRejectedValueOnce(terminated())
      .mockResolvedValue({ rows: [{ valid_from: '2005-12-29', valid_to: null }] })
    const repository = createPgSearchRepository({ query: poolQuery } as unknown as pg.Pool)
    const periodQuery = {
      period: { from: '2005-12-01', to: '2006-01-01' },
      scopes: ['go:cte:art:47'],
      families: ['cte'],
      reviewStatuses: ['auto', 'approved'] as const,
    }
    await expect(repository.versionsInPeriod(periodQuery)).resolves.toEqual([
      { from: '2005-12-29', to: null },
    ])
    // A primeira tentativa caiu (57P01) e a leitura foi repetida.
    expect(poolQuery).toHaveBeenCalledTimes(2)
    expect(poolQuery).toHaveBeenLastCalledWith(PERIOD_VERSIONS_SQL, [
      '2005-12-01',
      '2006-01-01',
      ['cte'],
      ['auto', 'approved'],
      ['go:cte:art:47'],
    ])
    expect(periodVersionsParameters(periodQuery)).toHaveLength(5)
    await expect(repository.versionsInPeriod({ ...periodQuery, scopes: [] })).resolves.toEqual([])
    await expect(repository.versionsInPeriod({ ...periodQuery, families: [] })).resolves.toEqual([])
    expect(poolQuery).toHaveBeenCalledTimes(2)
  })

  it('segunda queda seguida propaga o erro', async () => {
    const { pool, release } = fakePool([terminated(), terminated()])
    await expect(createPgSearchRepository(pool).search(query)).rejects.toMatchObject({
      code: '57P01',
    })
    expect(release).toHaveBeenCalledTimes(2)
  })
})
