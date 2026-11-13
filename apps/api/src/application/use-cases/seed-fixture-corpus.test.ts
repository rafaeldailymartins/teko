import { describe, expect, it, vi } from 'vitest'
import type { ParsedSource } from '#domain/corpus/parsed-source.ts'
import type { FixtureCorpusStore } from '../ports/fixture-corpus-store.ts'
import type { IngestDocumentVersion } from './ingest-document-version.ts'
import type { FinishIngestionRun, StartIngestionRun } from './ingestion-run.ts'
import type { RefreshCoverage } from './refresh-coverage.ts'
import {
  createSeedFixtureCorpus,
  FIXTURE_PARSER_REVISION,
  FixtureSeedError,
} from './seed-fixture-corpus.ts'

function source(slug: string, versionLabel: string): ParsedSource {
  return {
    document: { slug, family: 'rcte', title: slug, issuer: 'GO', sourceUrl: 'https://x' },
    version: {
      versionLabel,
      publishedOn: '2026-09-16',
      validDuring: { from: '2026-09-16', to: null },
      consolidatedUntil: null,
      actRef: null,
      sha256: 'a'.repeat(64),
    },
    replacementWindow: { from: null, to: null },
    provisions: [],
    skipped: [],
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  }
}

const published = {
  status: 'published',
  documentVersionId: 'dv',
  reprocessed: false,
  provisionVersionsNew: 3,
  provisionVersionsWidened: 0,
  provisionVersionsSplit: 0,
  knowledgeClosed: 0,
  chunksNew: 4,
  reviewItems: 0,
  neurons: 1,
  churn: {
    openBefore: 0,
    closed: 0,
    inserted: 3,
    provisionsBefore: 0,
    provisionsLost: 0,
    pendingShareBefore: 0,
    pendingShareAfter: 0,
  },
  churnViolations: [],
} as const

const coverage = [
  {
    family: 'rcte',
    covered: [{ from: '1998-01-01', to: null }],
    verifiedAt: '2026-11-10',
    gaps: [],
    gapReason: null,
  },
] as const

function setup(ingest: IngestDocumentVersion) {
  const calls: string[] = []
  const store: FixtureCorpusStore = {
    clearCorpus: vi.fn(() => {
      calls.push('clear')
      return Promise.resolve()
    }),
    declareCoverage: vi.fn(() => {
      calls.push('declare')
      return Promise.resolve()
    }),
  }
  const startIngestionRun = vi.fn<StartIngestionRun>(() => {
    calls.push('start')
    return Promise.resolve({ runId: 'run-1' })
  })
  const ingestDocumentVersion = vi.fn<IngestDocumentVersion>((command) => {
    calls.push(`ingest ${command.source.version.versionLabel}`)
    return ingest(command)
  })
  const refreshCoverage = vi.fn<RefreshCoverage>(() => {
    calls.push('refresh')
    return Promise.resolve({ corpusVersion: 7 })
  })
  const finishIngestionRun = vi.fn<FinishIngestionRun>(({ status }) => {
    calls.push(`finish ${status}`)
    return Promise.resolve({ dbBytes: 1, cuSeconds: null })
  })
  const seed = createSeedFixtureCorpus({
    startIngestionRun,
    ingestDocumentVersion,
    refreshCoverage,
    finishIngestionRun,
    store,
  })
  return { seed, calls, store, ingestDocumentVersion, refreshCoverage, finishIngestionRun }
}

const command = {
  sources: [source('rcte', 'v1'), source('cte', 'v2')],
  coverage,
  verifiedAt: '2026-11-10',
  gitSha: 'abc1234',
  replace: false,
}

describe('createSeedFixtureCorpus', () => {
  it('ingere cada versão de documento num run de fixture, abre a versão e declara a cobertura', async () => {
    const { seed, calls, ingestDocumentVersion, refreshCoverage, finishIngestionRun, store } =
      setup(() => Promise.resolve(published))
    await expect(seed(command)).resolves.toEqual({
      runId: 'run-1',
      corpusVersion: 7,
      documentVersions: 2,
      unchanged: 0,
      provisionVersions: 6,
      chunks: 8,
    })
    expect(calls).toEqual([
      'start',
      'ingest v1',
      'ingest v2',
      'refresh',
      'declare',
      'finish succeeded',
    ])
    expect(ingestDocumentVersion.mock.calls[0]?.[0]).toMatchObject({
      runId: 'run-1',
      blobRaw: null,
      blobDocling: null,
      parserRevision: FIXTURE_PARSER_REVISION,
      acceptChurn: true,
    })
    expect(refreshCoverage).toHaveBeenCalledWith({ runId: 'run-1', verifiedAt: '2026-11-10' })
    expect(store.declareCoverage).toHaveBeenCalledWith(coverage)
    expect(finishIngestionRun.mock.calls[0]?.[0].report).toMatchObject({ corpusVersion: 7 })
  })

  it('seed repetido: versões já publicadas saem unchanged, sem contar redações', async () => {
    const { seed } = setup(() => Promise.resolve({ status: 'unchanged', documentVersionId: 'dv' }))
    await expect(seed(command)).resolves.toMatchObject({
      unchanged: 2,
      provisionVersions: 0,
      chunks: 0,
    })
  })

  it('replace esvazia o corpus antes do run', async () => {
    const { seed, calls } = setup(() => Promise.resolve(published))
    await seed({ ...command, replace: true })
    expect(calls.slice(0, 2)).toEqual(['clear', 'start'])
  })

  it('orçamento esgotado ou erro: fecha o run como failed e propaga', async () => {
    const exhausted = setup(() =>
      Promise.resolve({
        status: 'budget_exhausted',
        neurons: 8000,
        embeddedChunks: 1,
        pendingChunks: 2,
      }),
    )
    await expect(exhausted.seed(command)).rejects.toBeInstanceOf(FixtureSeedError)
    expect(exhausted.calls.at(-1)).toBe('finish failed')
    expect(exhausted.finishIngestionRun.mock.calls[0]?.[0].report).toEqual({
      error: 'orçamento de neurons esgotado em rcte v1',
    })

    const failing = setup(() => Promise.reject('banco fora'))
    failing.finishIngestionRun.mockRejectedValueOnce(new Error('também fora'))
    await expect(failing.seed(command)).rejects.toBe('banco fora')
    expect(failing.finishIngestionRun.mock.calls[0]?.[0].report).toEqual({ error: 'banco fora' })
  })
})
