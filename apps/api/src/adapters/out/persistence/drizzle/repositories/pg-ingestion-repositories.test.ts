import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it } from 'vitest'
import { createPgEmbeddingCache } from './pg-embedding-cache.ts'
import { createPgCorpusIngestionRepository } from './pg-ingestion-corpus-repository.ts'
import { createPgDatabaseUsage, createPgVectorIndexMaintenance } from './pg-ingestion-database.ts'
import { createPgIngestionRunRepository } from './pg-ingestion-run-repository.ts'

/**
 * Cliente `pg` falso para o Drizzle: grava cada instrução e responde pelo `respond` (linhas como
 * objetos; convertidas para arrays quando o Drizzle pede `rowMode: 'array'`). O caminho real, contra
 * o Postgres, é coberto por `test/integration/ingest/`.
 */
interface Statement {
  readonly text: string
  readonly values: readonly unknown[]
}

type Respond = (text: string, values: readonly unknown[]) => Record<string, unknown>[] | undefined

function fakeDb(respond: Respond = () => undefined) {
  const statements: Statement[] = []
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
        return Promise.resolve({
          rows: Array.from({ length: count }, (_, offset) => ({ id: `id-${String(offset + 1)}` })),
          fields: [],
        })
      }
      const rows = respond(text, values) ?? []
      return Promise.resolve({
        rows: arrayMode ? rows.map((row) => Object.values(row)) : rows,
        fields: [],
      })
    },
  }
  return { db: drizzle({ client: client as never }), statements }
}

const texts = (statements: readonly Statement[]) => statements.map((statement) => statement.text)

describe('PgIngestionRunRepository', () => {
  it('abre, lê, soma neurons, consulta o dia e fecha mesclando o report', async () => {
    const { db, statements } = fakeDb((text) => {
      if (text.startsWith('insert into "corpus"."ingestion_runs"')) {
        return [{ id: 'run-1' }]
      }
      if (text.includes('AS total')) {
        return [{ total: 42 }]
      }
      if (text.startsWith('select "report"')) {
        return [{ report: { bulk: true, chunksNew: 1 } }]
      }
      if (text.startsWith('select')) {
        return [
          {
            id: 'run-1',
            target: 'staging',
            gitSha: 'g',
            status: 'running',
            docs: 0,
            chunksNew: 0,
            neuronsEst: 0,
            neurons: 3,
            cuSeconds: null,
            dbBytes: null,
            report: { bulk: true },
            startedAt: new Date(),
            finishedAt: null,
          },
        ]
      }
      return undefined
    })
    const runs = createPgIngestionRunRepository(db)
    expect(
      await runs.start({
        target: 'staging',
        gitSha: 'g',
        report: {},
        startedAt: new Date('2026-11-10T12:00:00Z'),
      }),
    ).toBe('run-1')
    expect(await runs.get('run-1')).toEqual({
      id: 'run-1',
      target: 'staging',
      status: 'running',
      neurons: 3,
      report: { bulk: true },
    })
    await runs.addNeurons('run-1', 2.2)
    expect(await runs.neuronsSpentOn('2026-11-10', 'America/Sao_Paulo')).toBe(42)
    await runs.finish({
      runId: 'run-1',
      status: 'succeeded',
      report: { chunksNew: 9 },
      cuSeconds: 12.5,
      dbBytes: 99,
    })
    const finish = statements.at(-1)
    expect(finish?.text).toMatch(/^update "corpus"."ingestion_runs"/)
    expect(finish?.values).toContain('12.500')
    expect(finish?.values).toContain(9)
    expect(
      statements.find((statement) => statement.text.includes('"neurons" + '))?.values,
    ).toContain(3)
  })

  it('run inexistente, report não-objeto e valores desconhecidos', async () => {
    let row: Record<string, unknown> | null = null
    const { db } = fakeDb((text) => (text.startsWith('select') && row !== null ? [row] : []))
    const runs = createPgIngestionRunRepository(db)
    expect(await runs.get('x')).toBeNull()
    expect(await runs.neuronsSpentOn('2026-11-10', 'UTC')).toBe(0)
    // Na ordem das colunas do schema (o Drizzle lê as linhas em modo array).
    const runRow = (target: string, status: string, report: unknown) => ({
      id: 'r',
      target,
      gitSha: 'g',
      status,
      docs: 0,
      chunksNew: 0,
      neuronsEst: 0,
      neurons: 0,
      cuSeconds: null,
      dbBytes: null,
      report,
      startedAt: new Date(),
      finishedAt: null,
    })
    row = runRow('fixture', 'failed', [1])
    expect(await runs.get('r')).toMatchObject({ target: 'fixture', status: 'failed', report: {} })
    row = runRow('outro', 'failed', null)
    await expect(runs.get('r')).rejects.toThrow(/target/)
    row = runRow('staging', 'outro', null)
    await expect(runs.get('r')).rejects.toThrow(/status/)
    await runs.finish({ runId: 'r', status: 'failed', report: {}, cuSeconds: null, dbBytes: null })
  })

  it('start sem RETURNING é erro', async () => {
    const runs = createPgIngestionRunRepository(fakeDb().db)
    await expect(
      runs.start({ target: 'staging', gitSha: 'g', report: {}, startedAt: new Date() }),
    ).rejects.toThrow()
  })
})

describe('PgEmbeddingCache', () => {
  it('lê em lotes de 500 hashes e grava ignorando conflitos', async () => {
    const { db, statements } = fakeDb((text) =>
      text.startsWith('select') ? [{ hash: 'h1', embedding: '[0.5,0.25]' }] : undefined,
    )
    const cache = createPgEmbeddingCache(db)
    const found = await cache.getMany(
      [...Array.from({ length: 600 }, (_, i) => `h${String(i)}`), 'h1'],
      'm',
    )
    expect(found.get('h1')).toEqual([0.5, 0.25])
    expect(statements.filter((statement) => statement.text.startsWith('select'))).toHaveLength(2)
    await cache.putMany([], 'm')
    await cache.putMany([{ hash: 'h9', vector: [1, 0] }], 'm')
    expect(statements.at(-1)?.text).toMatch(/on conflict do nothing/)
  })
})

describe('PgDatabaseUsage e VectorIndexMaintenance', () => {
  it('lê pg_database_size e derruba/recria o HNSW com maintenance_work_mem', async () => {
    const { db, statements } = fakeDb((text) =>
      text.includes('pg_database_size') ? [{ bytes: '1234' }] : undefined,
    )
    expect(await createPgDatabaseUsage(db).sizeBytes()).toBe(1234)
    const index = createPgVectorIndexMaintenance(db)
    await index.dropVectorIndex()
    await index.ensureVectorIndex()
    expect(texts(statements).join('\n')).toMatch(
      /DROP INDEX IF EXISTS corpus.chunks_embedding_hnsw/,
    )
    expect(texts(statements).join('\n')).toMatch(/SET LOCAL maintenance_work_mem = '512MB'/)
    expect(texts(statements).join('\n')).toMatch(/CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw/)
    expect(await createPgDatabaseUsage(fakeDb().db).sizeBytes()).toBe(0)
  })
})

describe('PgCorpusIngestionRepository', () => {
  const openRow = {
    id: 'pv1',
    stable_key: 'go:rcte:art:1',
    modality: 'mandatory',
    review_status: 'auto',
    content_hash: 'h',
    valid_during: '[2000-01-01,)',
  }

  function repository(extra: Respond = () => undefined) {
    return fakeDb((text, values) => {
      const custom = extra(text, values)
      if (custom !== undefined) {
        return custom
      }
      if (text.startsWith('insert into "corpus"."documents"')) {
        return [{ id: 'doc' }]
      }
      if (text.startsWith('insert into "corpus"."document_versions"')) {
        return [{ id: 'dv' }]
      }
      if (text.includes('FROM corpus.provisions') && text.includes('stable_key = ANY')) {
        return [{ id: 'p-existing', stable_key: 'go:rcte:art:1', document_id: 'doc' }]
      }
      if (text.startsWith('insert into "corpus"."provisions"')) {
        return values
          .filter((value): value is string => typeof value === 'string' && value.startsWith('go:'))
          .map((stableKey) => ({ id: `id-${stableKey}`, stableKey }))
      }
      if (text.includes('upper_inf(pv.knowledge)')) {
        return [openRow]
      }
      if (text.includes('RETURNING id') && text.includes('document_versions')) {
        return [{ id: 'old' }]
      }
      if (text.startsWith('insert into "corpus"."review_queue"')) {
        return [{ id: 'q1' }]
      }
      if (text.includes('AS orphans')) {
        return [{ orphans: 0 }]
      }
      return undefined
    })
  }

  it('unidade de trabalho: todas as operações numa transação', async () => {
    const { db, statements } = repository()
    const repo = createPgCorpusIngestionRepository(db)
    const result = await repo.transaction(async (uow) => {
      const documentId = await uow.upsertDocument({
        slug: 'rcte',
        family: 'rcte',
        jurisdiction: 'GO',
        title: 'RCTE',
        issuer: 'GO',
        sourceUrl: 'https://x',
      })
      const dv = await uow.insertDocumentVersion({
        documentId,
        version: {
          versionLabel: 'v',
          publishedOn: '2026-06-01',
          validDuring: { from: '2026-06-01', to: null },
          consolidatedUntil: null,
          actRef: null,
          sha256: 'a'.repeat(64),
        },
        runId: 'run',
        blobRaw: null,
        blobDocling: null,
      })
      expect(await uow.closePreviousDocumentVersions(documentId, dv, '2026-06-01')).toBe(1)
      const ids = await uow.upsertProvisions(documentId, [
        { stableKey: 'go:rcte:art:1', kind: 'artigo', parentStableKey: null, sortPath: '0001' },
        {
          stableKey: 'go:rcte:art:1:par:1',
          kind: 'paragrafo',
          parentStableKey: 'go:rcte:art:1',
          sortPath: '0001.p01',
        },
      ])
      expect(ids.get('go:rcte:art:1:par:1')).toBe('id-go:rcte:art:1:par:1')
      await uow.addProvisionLabels([
        { provisionId: 'p', label: '§ 1º', validDuring: { from: '2000-01-01', to: null } },
      ])
      expect(await uow.lockOpenVersions(documentId)).toEqual([
        {
          id: 'pv1',
          stableKey: 'go:rcte:art:1',
          modality: 'mandatory',
          reviewStatus: 'auto',
          contentHash: 'h',
          validDuring: { from: '2000-01-01', to: null },
        },
      ])
      await uow.closeKnowledge([], '2026-06-01')
      await uow.closeKnowledge(['pv1'], '2026-06-01')
      expect(
        await uow.insertRemainders([
          { sourceId: 'pv1', validDuring: { from: '2000-01-01', to: '2026-01-01' } },
        ]),
      ).toEqual(['id-1'])
      await uow.widen([{ id: 'pv2', validDuring: { from: '1990-01-01', to: null } }])
      const amendment = {
        actLabel: 'Decreto',
        actKind: 'decreto',
        actDate: '2026-05-01',
        changeKind: 'nova_redacao' as const,
        rawNote: 'nota',
      }
      const row = {
        provisionId: 'p',
        headingPath: 'RCTE > Art. 1',
        displayLabel: 'RCTE, art. 1',
        knowledge: { from: '2026-06-01', to: null },
        modality: 'mandatory' as const,
        validityBasis: 'legal_effect' as const,
        retroactive: false,
        reviewStatus: 'auto' as const,
        text: 'Art. 1.',
        contentHash: 'h2',
        structured: null,
        chunks: [{ ordinal: 0, content: 'Art. 1.', contentHash: 'c', embedding: [0.5, 0.25] }],
      }
      const inserted = await uow.insertVersions(
        [
          {
            ...row,
            validDuring: { from: '2000-01-01', to: '2010-01-01' },
            amendment: { ...amendment, effectiveFrom: '2000-01-01' },
          },
          {
            ...row,
            validDuring: { from: '2000-01-01', to: '2010-01-01' },
            amendment: { ...amendment, effectiveFrom: '2011-01-01' },
          },
          { ...row, validDuring: { from: '2000-01-01', to: null }, amendment: null },
        ],
        { family: 'rcte', jurisdiction: 'GO', embeddingModel: 'bge' },
      )
      expect(inserted).toHaveLength(3)
      await uow.addSources([], dv)
      await uow.addSources(inserted, dv)
      expect(
        await uow.enqueueReview([
          {
            runId: 'run',
            provisionId: 'p',
            provisionVersionId: 'pv',
            documentVersionId: dv,
            stableKey: 'go:rcte:art:1',
            noteHash: 'n',
            reason: 'note-unparsed',
            rawNote: null,
            proposed: { from: '2000-01-01', to: null },
          },
        ]),
      ).toBe(1)
      await uow.markPublished(dv)
      await uow.assertPublishedSources(documentId)
      return 'ok'
    })
    expect(result).toBe('ok')
    const all = texts(statements)
    expect(all[0]).toBe('begin')
    expect(all.at(-1)).toBe('commit')
    const amendmentInsert = statements.find((statement) =>
      statement.text.startsWith('insert into "corpus"."amendments"'),
    )
    // Data de efeito posterior ao fim da redação: o início da redação evita o range vazio.
    expect(amendmentInsert?.values).toContain('[2000-01-01,2010-01-01)')
  })

  it('erros de invariante desfazem a transação', async () => {
    const orphan = repository((text) =>
      text.includes('AS orphans') ? [{ orphans: 2 }] : undefined,
    )
    await expect(
      createPgCorpusIngestionRepository(orphan.db).transaction((uow) =>
        uow.assertPublishedSources('doc'),
      ),
    ).rejects.toThrow(/2 chunk/)
    expect(texts(orphan.statements).at(-1)).toBe('rollback')

    const foreign = repository((text) =>
      text.includes('stable_key = ANY')
        ? [{ id: 'x', stable_key: 'go:rcte:art:1', document_id: 'outro' }]
        : undefined,
    )
    await expect(
      createPgCorpusIngestionRepository(foreign.db).transaction((uow) =>
        uow.upsertProvisions('doc', [
          { stableKey: 'go:rcte:art:1', kind: 'artigo', parentStableKey: null, sortPath: '1' },
        ]),
      ),
    ).rejects.toThrow(/outro documento/)

    const orphanParent = repository((text) => (text.includes('stable_key = ANY') ? [] : undefined))
    await expect(
      createPgCorpusIngestionRepository(orphanParent.db).transaction((uow) =>
        uow.upsertProvisions('doc', [
          {
            stableKey: 'go:rcte:art:1:par:1',
            kind: 'paragrafo',
            parentStableKey: 'go:rcte:art:1',
            sortPath: '1',
          },
        ]),
      ),
    ).rejects.toThrow(/pai/)

    const silent = fakeDb()
    const repo = createPgCorpusIngestionRepository(silent.db)
    await expect(
      repo.transaction((uow) =>
        uow.upsertDocument({
          slug: 's',
          family: 'rcte',
          jurisdiction: 'GO',
          title: 't',
          issuer: 'i',
          sourceUrl: 'u',
        }),
      ),
    ).rejects.toThrow(/não gravado/)
    await expect(
      repo.transaction((uow) =>
        uow.insertDocumentVersion({
          documentId: 'd',
          version: {
            versionLabel: 'v',
            publishedOn: '2026-01-01',
            validDuring: { from: '2026-01-01', to: null },
            consolidatedUntil: null,
            actRef: null,
            sha256: 'b',
          },
          runId: 'r',
          blobRaw: null,
          blobDocling: null,
        }),
      ),
    ).rejects.toThrow(/não gravada/)
    expect(await repo.transaction((uow) => uow.upsertProvisions('doc', []))).toEqual(new Map())
  })

  it('leituras fora da transação e o RefreshCoverage', async () => {
    let families: Record<string, unknown>[] = [{ family: 'rcte' }]
    const { db, statements } = repository((text) => {
      if (text.startsWith('select "id", "status"')) {
        return [{ id: 'dv', status: 'published' }]
      }
      if (text.includes('SELECT DISTINCT d.family')) {
        return families
      }
      if (text.startsWith('insert into "corpus"."corpus_versions"')) {
        return [{ id: 7 }]
      }
      if (text.includes('max(id) AS id')) {
        return [{ id: 6 }]
      }
      return undefined
    })
    const repo = createPgCorpusIngestionRepository(db)
    expect(await repo.findDocumentVersion('a')).toEqual({ id: 'dv', status: 'published' })
    expect(await repo.openVersionsOf('rcte')).toHaveLength(1)
    expect(
      await repo.refreshCoverage({
        runId: 'r',
        verifiedAt: '2026-11-10',
        families: undefined,
        notes: 'n',
      }),
    ).toEqual({
      corpusVersion: 7,
    })
    expect(texts(statements).join('\n')).toMatch(/range_agg/)
    expect(
      await repo.refreshCoverage({
        runId: 'r',
        verifiedAt: '2026-11-10',
        families: ['cte'],
        notes: 'n',
      }),
    ).toEqual({
      corpusVersion: 7,
    })
    families = []
    expect(
      await repo.refreshCoverage({
        runId: 'r',
        verifiedAt: '2026-11-10',
        families: undefined,
        notes: 'n',
      }),
    ).toEqual({
      corpusVersion: 6,
    })
    families = [{ family: 'inexistente' }]
    await expect(
      repo.refreshCoverage({
        runId: 'r',
        verifiedAt: '2026-11-10',
        families: undefined,
        notes: 'n',
      }),
    ).rejects.toThrow(/família/)
  })

  it('status e ranges inesperados vindos do banco', async () => {
    const odd = repository((text) => {
      if (text.startsWith('select "id", "status"')) {
        return [{ id: 'dv', status: 'estranho' }]
      }
      if (text.includes('upper_inf(pv.knowledge)')) {
        return [{ ...openRow, valid_during: 'empty' }]
      }
      return undefined
    })
    const repo = createPgCorpusIngestionRepository(odd.db)
    await expect(repo.findDocumentVersion('a')).rejects.toThrow(/status/)
    await expect(repo.openVersionsOf('rcte')).rejects.toThrow(/vazio/)
    expect(await createPgCorpusIngestionRepository(fakeDb().db).findDocumentVersion('a')).toBeNull()
  })
})
