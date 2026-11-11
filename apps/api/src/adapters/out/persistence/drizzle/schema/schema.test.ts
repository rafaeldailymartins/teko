import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './index.ts'

const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[]

function columnOf(table: PgTable, name: string) {
  const column = getTableConfig(table).columns.find((candidate) => candidate.name === name)
  if (column === undefined) {
    throw new Error(`coluna ${name} ausente`)
  }
  return column
}

describe('schema canônico', () => {
  it('tem as tabelas de corpus e app, com colunas em snake_case', () => {
    const names = tables.map((table) => {
      const config = getTableConfig(table)
      return `${String(config.schema)}.${config.name}`
    })
    expect(names.sort()).toEqual([
      'app.answer_cache',
      'app.feedback',
      'app.questions',
      'app.rate_limits',
      'app.usage_daily',
      'corpus.amendments',
      'corpus.chunk_sources',
      'corpus.chunks',
      'corpus.corpus_versions',
      'corpus.coverage',
      'corpus.document_versions',
      'corpus.documents',
      'corpus.embedding_cache',
      'corpus.ingestion_runs',
      'corpus.provision_labels',
      'corpus.provision_versions',
      'corpus.provisions',
      'corpus.review_queue',
    ])
    for (const table of tables) {
      for (const column of getTableConfig(table).columns) {
        expect(column.name).toMatch(/^[a-z0-9_]+$/)
      }
    }
  })

  it('as chaves estrangeiras apontam para tabelas do schema', () => {
    const references = tables.flatMap((table) =>
      getTableConfig(table).foreignKeys.map((fk) => {
        const reference = fk.reference()
        return `${getTableConfig(table).name}.${reference.columns.map((c) => c.name).join()} -> ${getTableConfig(reference.foreignTable).name}`
      }),
    )
    expect(references).toContain('chunks.provision_version_id -> provision_versions')
    expect(references).toContain('provisions.parent_id -> provisions')
    expect(references).toContain('feedback.question_id -> questions')
    expect(references).toHaveLength(14)
  })

  it('índices HNSW, GIN e GiST da busca e o GIN trigram de stable_key', () => {
    const indexes = getTableConfig(schema.chunks).indexes.map((index) => index.config.name)
    expect(indexes).toEqual(
      expect.arrayContaining([
        'chunks_tsv_gin',
        'chunks_embedding_hnsw',
        'chunks_family_valid_during_gist',
      ]),
    )
    expect(getTableConfig(schema.provisions).indexes.map((index) => index.config.name)).toContain(
      'provisions_stable_key_trgm',
    )
    expect(schema.EMBEDDING_DIMENSIONS).toBe(1024)
  })
})

describe('tipos de range', () => {
  const validDuring = columnOf(schema.chunks, 'valid_during')
  const covered = columnOf(schema.coverage, 'covered')
  const tsv = columnOf(schema.chunks, 'tsv')

  it('daterange converte nos dois sentidos e recusa range vazio vindo do banco', () => {
    expect(validDuring.getSQLType()).toBe('daterange')
    expect(validDuring.mapToDriverValue({ from: '2004-11-04', to: '2009-11-23' })).toBe(
      '[2004-11-04,2009-11-23)',
    )
    expect(validDuring.mapFromDriverValue('[2004-11-04,2009-11-23)')).toEqual({
      from: '2004-11-04',
      to: '2009-11-23',
    })
    expect(() => validDuring.mapFromDriverValue('empty')).toThrow(/vazio/)
  })

  it('datemultirange converte nos dois sentidos', () => {
    expect(covered.getSQLType()).toBe('datemultirange')
    expect(covered.mapToDriverValue([{ from: '1998-01-01', to: null }])).toBe('{[1998-01-01,)}')
    expect(covered.mapFromDriverValue('{[1998-01-01,),[1990-01-01,1991-01-01)}')).toEqual([
      { from: '1990-01-01', to: '1991-01-01' },
      { from: '1998-01-01', to: null },
    ])
    expect(tsv.getSQLType()).toBe('tsvector')
  })
})
