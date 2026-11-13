import { describe, expect, it } from 'vitest'
import type { CorpusIngestionRepository } from '../ports/corpus-ingestion-repository.ts'
import { DatabaseSizeLimitError } from '../ports/database-usage.ts'
import type {
  FinishRunRecord,
  IngestionRunRepository,
  StartRunRecord,
} from '../ports/ingestion-run-repository.ts'
import {
  BulkLoadNotAllowedError,
  createFinishIngestionRun,
  createStartIngestionRun,
  IngestionRunNotFoundError,
} from './ingestion-run.ts'
import { createInspectCorpus } from './inspect-corpus.ts'
import { createRefreshCoverage } from './refresh-coverage.ts'

const NOW = new Date('2026-11-10T12:00:00-03:00')

function setup(
  options: { readonly compute?: (number | null | Error)[]; readonly missing?: boolean } = {},
) {
  const compute = [...(options.compute ?? [null, null])]
  const started: StartRunRecord[] = []
  const finished: FinishRunRecord[] = []
  const index: string[] = []
  const runs: IngestionRunRepository = {
    start: (record) => {
      started.push(record)
      return Promise.resolve('run-1')
    },
    get: (runId) =>
      Promise.resolve(
        options.missing === true
          ? null
          : {
              id: runId,
              target: 'staging',
              status: 'running',
              neurons: 0,
              report: started[0]?.report ?? {},
            },
      ),
    addNeurons: () => Promise.resolve(),
    neuronsSpentOn: () => Promise.resolve(0),
    finish: (record) => {
      finished.push(record)
      return Promise.resolve()
    },
  }
  const deps = {
    runs,
    clock: { now: () => new Date(NOW) },
    databaseUsage: { sizeBytes: () => Promise.resolve(4096) },
    vectorIndex: {
      dropVectorIndex: () => {
        index.push('drop')
        return Promise.resolve()
      },
      ensureVectorIndex: () => {
        index.push('ensure')
        return Promise.resolve()
      },
    },
    compute: {
      computeSeconds: () => {
        const next = compute.shift() ?? null
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
      },
    },
  }
  return {
    start: createStartIngestionRun(deps),
    finish: createFinishIngestionRun(deps),
    started,
    finished,
    index,
  }
}

describe('StartIngestionRun / FinishIngestionRun', () => {
  it('abre o run com o instante do relógio e fecha com CU-s e tamanho do banco', async () => {
    const run = setup({ compute: [100, 160.5] })
    expect(await run.start({ target: 'staging', gitSha: 'abc' })).toEqual({ runId: 'run-1' })
    expect(run.started).toEqual([
      {
        target: 'staging',
        gitSha: 'abc',
        report: { bulk: false, computeSecondsAtStart: 100 },
        startedAt: NOW,
      },
    ])
    expect(
      await run.finish({ runId: 'run-1', status: 'succeeded', report: { chunksNew: 3 } }),
    ).toEqual({ dbBytes: 4096, cuSeconds: 60.5 })
    expect(run.finished).toEqual([
      {
        runId: 'run-1',
        status: 'succeeded',
        report: { chunksNew: 3 },
        cuSeconds: 60.5,
        dbBytes: 4096,
      },
    ])
    // B6: sem --bulk, a abertura garante o HNSW (um --bulk anterior pode ter caído no meio).
    expect(run.index).toEqual(['ensure', 'ensure'])
  })

  it('--bulk só no staging: derruba o HNSW no início', async () => {
    const run = setup()
    await expect(
      run.start({ target: 'production', gitSha: 'x', bulk: true }),
    ).rejects.toBeInstanceOf(BulkLoadNotAllowedError)
    await run.start({ target: 'staging', gitSha: 'x', bulk: true })
    expect(run.index).toEqual(['drop'])
  })

  it('sem medição (ou com a API do Neon fora), cu_seconds fica nulo', async () => {
    const run = setup({ compute: [new Error('fora do ar'), 10] })
    await run.start({ target: 'staging', gitSha: 'x' })
    await run.finish({ runId: 'run-1', status: 'failed', report: {} })
    expect(run.finished[0]?.cuSeconds).toBeNull()
    const other = setup({ compute: [10, null] })
    await other.start({ target: 'staging', gitSha: 'x' })
    await other.finish({ runId: 'run-1', status: 'budget_exhausted', report: {} })
    expect(other.finished[0]?.cuSeconds).toBeNull()
  })

  it('fechar um run inexistente é erro', async () => {
    const run = setup({ missing: true })
    await expect(
      run.finish({ runId: 'x', status: 'succeeded', report: {} }),
    ).rejects.toBeInstanceOf(IngestionRunNotFoundError)
  })
})

describe('RefreshCoverage', () => {
  it('repassa o run, a data e as famílias, com a nota do run', async () => {
    const records: unknown[] = []
    const repository: CorpusIngestionRepository = {
      findDocumentVersion: () => Promise.resolve(null),
      findPublishedByFingerprint: () => Promise.resolve(null),
      openVersionsOf: () => Promise.resolve([]),
      transaction: () => Promise.reject(new Error('não usado')),
      refreshCoverage: (record) => {
        records.push(record)
        return Promise.resolve({ corpusVersion: 7 })
      },
      documentHealth: () =>
        Promise.resolve([
          { slug: 'rcte', family: 'rcte', provisions: 1, chunks: 2, pending: 0, versions: 1 },
        ]),
      openReviewQueue: () => Promise.resolve([{ family: 'rcte', reason: 'x', open: 1 }]),
      openChunkTexts: () => {
        throw new Error('não usado')
      },
    }
    const refresh = createRefreshCoverage({ repository })
    expect(await refresh({ runId: 'r', verifiedAt: '2026-11-10', families: ['rcte'] })).toEqual({
      corpusVersion: 7,
    })
    expect(records).toEqual([
      { runId: 'r', verifiedAt: '2026-11-10', families: ['rcte'], notes: 'ingestão r' },
    ])
    const inspect = createInspectCorpus({ repository })
    expect(await inspect.documentHealth()).toHaveLength(1)
    expect(await inspect.openReviewQueue()).toEqual([{ family: 'rcte', reason: 'x', open: 1 }])
  })
})

describe('DatabaseSizeLimitError', () => {
  it('guarda o tamanho e o limite', () => {
    const error = new DatabaseSizeLimitError(900, 800)
    expect(error).toMatchObject({ name: 'DatabaseSizeLimitError', sizeBytes: 900, limitBytes: 800 })
    expect(error.message).toContain('900')
  })
})
