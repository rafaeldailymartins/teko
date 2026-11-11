import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it } from 'vitest'
import type { CorpusSnapshot, DocumentRecord } from '#app/ports/corpus-writer.ts'
import { CorpusInvariantError, createPgCorpusWriter } from './pg-corpus-writer.ts'
import { createPgCoverageRepository } from './pg-coverage-repository.ts'

/**
 * Cliente `pg` falso para o Drizzle (`drizzle-orm/node-postgres`): grava cada instrução e responde
 * às poucas que o writer lê (IDs `uuidv7()`, `RETURNING id` e a contagem de órfãos). O caminho real,
 * contra o Postgres, é coberto pelos testes de integração.
 */
interface Statement {
  readonly text: string
  readonly values: readonly unknown[]
}

function fakeClient(
  options: { readonly orphans?: number; readonly coverageRows?: unknown[][] } = {},
) {
  const statements: Statement[] = []
  let nextId = 0
  const client = {
    query(
      config: string | { text: string; values?: unknown[]; rowMode?: string },
      params?: unknown[],
    ) {
      const text = typeof config === 'string' ? config : config.text
      const values = (typeof config === 'string' ? params : config.values) ?? params ?? []
      const arrayMode = typeof config !== 'string' && config.rowMode === 'array'
      statements.push({ text, values })
      if (/uuidv7\(\)::text AS id FROM generate_series/.test(text)) {
        const count = Number(values[0])
        const first = nextId
        nextId += count
        return Promise.resolve({
          rows: Array.from({ length: count }, (_, offset) => ({
            id: `id-${String(first + offset + 1)}`,
          })),
          fields: [],
        })
      }
      if (/returning "id"/.test(text)) {
        nextId += 1
        const id = text.includes('corpus_versions') ? 42 : `run-${String(nextId)}`
        return Promise.resolve({ rows: arrayMode ? [[id]] : [{ id }], fields: [] })
      }
      if (text.includes('AS orphans')) {
        return Promise.resolve({ rows: [{ orphans: options.orphans ?? 0 }], fields: [] })
      }
      if (text.startsWith('select') && text.includes('"corpus"."coverage"')) {
        return Promise.resolve({ rows: options.coverageRows ?? [], fields: [] })
      }
      return Promise.resolve({ rows: [], fields: [] })
    },
  }
  return { db: drizzle({ client: client as never }), statements }
}

const version = {
  displayLabel: 'RCTE, art. 76, § 6º',
  validDuring: { from: '2004-11-04', to: '2009-11-23' },
  knowledge: { from: '2026-09-16', to: null },
  modality: 'mandatory',
  validityBasis: 'legal_effect',
  retroactive: false,
  reviewStatus: 'auto',
  text: '§ 6º ...',
  contentHash: 'h1',
  structured: null,
  amendment: {
    actLabel: 'Decreto nº 6.026',
    actKind: 'decreto',
    actDate: '2004-10-27',
    effectiveFrom: '2004-11-04',
    changeKind: 'nova_redacao',
    rawNote: 'CONFERIDA NOVA REDAÇÃO',
  },
  documentVersionKeys: ['v2026'],
  chunks: [
    { ordinal: 0, content: '§ 6º ...', contentHash: 'c1', embedding: [0.5, 0.25] },
    { ordinal: 1, content: '... cont.', contentHash: 'c2', embedding: null },
  ],
} as const

const doc: DocumentRecord = {
  slug: 'rcte',
  family: 'rcte',
  jurisdiction: 'GO',
  title: 'RCTE',
  issuer: 'Goiás',
  sourceUrl: 'https://x',
  versions: [
    {
      key: 'v2026',
      versionLabel: 'RCTE 2026',
      publishedOn: '2026-09-16',
      validDuring: { from: '2026-09-16', to: null },
      consolidatedUntil: null,
      actRef: null,
      sha256: 'a'.repeat(64),
    },
  ],
  provisions: [
    {
      stableKey: 'go:rcte:art:76:par:6',
      kind: 'paragrafo',
      parentStableKey: 'go:rcte:art:76',
      sortPath: '0076.p06',
      headingPath: 'RCTE > Art. 76 > § 6º',
      versions: [version],
    },
    {
      stableKey: 'go:rcte:art:76',
      kind: 'artigo',
      parentStableKey: null,
      sortPath: '0076',
      headingPath: 'RCTE > Art. 76',
      versions: [{ ...version, amendment: null, chunks: [version.chunks[0]] }],
    },
  ],
}

const snapshot: CorpusSnapshot = {
  documents: [doc],
  coverage: [
    {
      family: 'rcte',
      jurisdiction: 'GO',
      covered: [{ from: '1998-01-01', to: null }],
      verifiedAt: '2026-11-10',
      gaps: [],
      gapReason: null,
    },
  ],
  embeddingModel: '@cf/baai/bge-m3',
  notes: 'teste',
  replace: false,
}

function inserted(statements: readonly Statement[], table: string): Statement[] {
  return statements.filter((statement) =>
    statement.text.startsWith(`insert into "corpus"."${table}"`),
  )
}

describe('createPgCorpusWriter', () => {
  it('grava tudo numa transação, pais antes dos filhos, e conta redações e chunks', async () => {
    const { db, statements } = fakeClient()
    await expect(createPgCorpusWriter(db, { gitSha: 'abc' }).write(snapshot)).resolves.toEqual({
      corpusVersion: 42,
      documents: 1,
      provisionVersions: 2,
      chunks: 3,
    })
    expect(statements[0]?.text).toBe('begin')
    expect(statements.at(-1)?.text).toBe('commit')
    expect(statements.some((statement) => statement.text.startsWith('TRUNCATE'))).toBe(false)
    const provisionInserts = inserted(statements, 'provisions')
    expect(provisionInserts).toHaveLength(2)
    // O artigo (nível 1) vai num comando anterior ao do parágrafo (nível 2).
    expect(provisionInserts[0]?.values).toContain('go:rcte:art:76')
    expect(provisionInserts[1]?.values).toContain('go:rcte:art:76:par:6')
    expect(inserted(statements, 'amendments')).toHaveLength(1)
    const chunkInsert = inserted(statements, 'chunks')[0]
    expect(chunkInsert?.values).toContain('[0.5,0.25]')
    expect(chunkInsert?.values).toContain('@cf/baai/bge-m3')
    expect(inserted(statements, 'chunk_sources')).toHaveLength(1)
    expect(inserted(statements, 'coverage')[0]?.text).toContain('on conflict ("family") do update')
    expect(
      statements.some((statement) => statement.text.startsWith('update "corpus"."ingestion_runs"')),
    ).toBe(true)
  })

  it('com replace, esvazia o corpus na mesma transação', async () => {
    const { db, statements } = fakeClient()
    await createPgCorpusWriter(db, { gitSha: 'abc' }).write({
      ...snapshot,
      documents: [],
      replace: true,
    })
    expect(statements[1]?.text).toMatch(/^TRUNCATE corpus\.chunk_sources/)
  })

  it('chunk publicável sem fonte publicada desfaz tudo', async () => {
    const { db, statements } = fakeClient({ orphans: 2 })
    await expect(createPgCorpusWriter(db, { gitSha: 'abc' }).write(snapshot)).rejects.toThrow(
      new CorpusInvariantError('2 chunk(s) publicável(is) sem fonte publicada'),
    )
    expect(statements.at(-1)?.text).toBe('rollback')
  })

  it('pai ausente e versão de documento desconhecida são erros de invariante', async () => {
    const orphanChild: DocumentRecord = {
      ...doc,
      provisions: [doc.provisions[0] ?? (undefined as never)],
    }
    await expect(
      createPgCorpusWriter(fakeClient().db, { gitSha: 'abc' }).write({
        ...snapshot,
        documents: [orphanChild],
      }),
    ).rejects.toThrow('pai go:rcte:art:76 ausente')
    const unknownVersion: DocumentRecord = {
      ...doc,
      provisions: [
        {
          ...(doc.provisions[1] ?? (undefined as never)),
          versions: [{ ...version, amendment: null, documentVersionKeys: ['v1999'] }],
        },
      ],
    }
    await expect(
      createPgCorpusWriter(fakeClient().db, { gitSha: 'abc' }).write({
        ...snapshot,
        documents: [unknownVersion],
      }),
    ).rejects.toThrow('versão de documento v1999 desconhecida em rcte')
    expect(new CorpusInvariantError('x').name).toBe('CorpusInvariantError')
  })
})

describe('createPgCoverageRepository', () => {
  it('lê a cobertura por família, com ranges e jurisdição', async () => {
    const { db, statements } = fakeClient({
      coverageRows: [
        ['efd-icms-ipi', 'BR', '{[2025-01-01,)}', '2026-11-10', 1, '{[2026-11-05,)}', 'mudança'],
        ['rcte', 'GO', '{[1998-01-01,)}', '2026-11-10', 1, '{}', null],
      ],
    })
    await expect(createPgCoverageRepository(db).loadCoverage()).resolves.toEqual([
      {
        family: 'efd-icms-ipi',
        jurisdiction: 'BR',
        covered: [{ from: '2025-01-01', to: null }],
        verifiedAt: '2026-11-10',
        gaps: [{ from: '2026-11-05', to: null }],
      },
      {
        family: 'rcte',
        jurisdiction: 'GO',
        covered: [{ from: '1998-01-01', to: null }],
        verifiedAt: '2026-11-10',
        gaps: [],
      },
    ])
    expect(statements[0]?.text).toContain('order by "corpus"."coverage"."family"')
  })
})
