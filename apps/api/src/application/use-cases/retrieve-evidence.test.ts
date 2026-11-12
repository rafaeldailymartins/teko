import { describe, expect, it, vi } from 'vitest'
import type { Evidence } from '#domain/qa/evidence.ts'
import { type CoverageDecision, CoverageStatus } from '#domain/vigencia/coverage-decision.ts'
import type { CheckCoverage } from './check-coverage.ts'
import type { HybridSearch, HybridSearchResult } from './hybrid-search.ts'
import { createResolveReferenceDate } from './resolve-reference-date.ts'
import { createRetrieveEvidence, RetrievalOutcome } from './retrieve-evidence.ts'

const clock = { now: () => new Date('2026-11-10T12:00:00-03:00') }

function evidence(rrf: number, from: string, to: string | null): Evidence {
  return {
    chunkId: `c-${String(rrf)}`,
    stableKey: 'go:rcte:art:76:par:8',
    family: 'rcte',
    citationLabel: 'RCTE, art. 76, § 8º',
    content: '§ 8º ...',
    validity: { from, to },
    document: { versionId: 'v', versionLabel: 'RCTE 2026', title: 'RCTE', sourceUrl: 'https://x' },
    rrf,
    lexicalRank: 1,
    semanticRank: 1,
    referenceRank: null,
  }
}

const coverageEntry = {
  family: 'rcte',
  jurisdiction: 'GO' as const,
  covered: [{ from: '1998-01-01', to: '2026-11-11' }],
  verifiedAt: '2026-11-10',
}

function decision(status: CoverageDecision['status'], uncovered: string[] = []): CoverageDecision {
  return {
    status,
    coveredFamilies: status === CoverageStatus.OutOfCoverage ? [] : ['rcte'],
    uncoveredFamilies: uncovered,
    coverage: [coverageEntry],
  }
}

function setup(options: {
  readonly decision: CoverageDecision
  readonly search?: HybridSearchResult
  readonly minEvidenceRrf?: number
}) {
  const checkCoverage = vi.fn<CheckCoverage>(() => Promise.resolve(options.decision))
  const hybridSearch = vi.fn<HybridSearch>(() =>
    Promise.resolve(
      options.search ?? { mode: 'hybrid', evidence: [], stableKeys: [], reranked: false },
    ),
  )
  const retrieve = createRetrieveEvidence({
    resolveReferenceDate: createResolveReferenceDate({ clock }),
    checkCoverage,
    hybridSearch,
    minEvidenceRrf: options.minEvidenceRrf ?? 0,
  })
  return { retrieve, checkCoverage, hybridSearch }
}

const ask = {
  input: { periodoApuracao: '2026-07' },
  source: 'periodo_apuracao',
  questionText: 'O que diz o § 8º do art. 76?',
  families: ['rcte', 'efd-go'],
} as const

describe('createRetrieveEvidence', () => {
  it('datas conflitantes: pede esclarecimento sem consultar cobertura nem busca', async () => {
    const { retrieve, checkCoverage, hybridSearch } = setup({ decision: decision('covered') })
    await expect(
      retrieve({ ...ask, source: 'default', questionText: 'Comparar 01/2010 com 03/2004' }),
    ).resolves.toEqual({
      outcome: RetrievalOutcome.NeedsClarification,
      reason: 'ambiguous_text',
      candidates: ['2004-03-01', '2010-01-01'],
    })
    expect(checkCoverage).not.toHaveBeenCalled()
    expect(hybridSearch).not.toHaveBeenCalled()
  })

  it('fora da cobertura: recusa sem busca, com a cobertura das famílias', async () => {
    const { retrieve, checkCoverage, hybridSearch } = setup({
      decision: decision('out_of_coverage'),
    })
    await expect(retrieve(ask)).resolves.toMatchObject({
      outcome: RetrievalOutcome.Refused,
      reason: 'out_of_coverage',
      reference: { value: '2026-07-01' },
      coverage: [coverageEntry],
      mode: null,
    })
    expect(checkCoverage).toHaveBeenCalledWith('2026-07-01', ['rcte', 'efd-go'])
    expect(hybridSearch).not.toHaveBeenCalled()
  })

  it('retrieval vazio: recusa no_evidence com o modo da busca', async () => {
    const { retrieve } = setup({
      decision: decision('covered'),
      search: { mode: 'lexical_only', evidence: [], stableKeys: [], reranked: false },
    })
    await expect(retrieve(ask)).resolves.toMatchObject({
      outcome: RetrievalOutcome.Refused,
      reason: 'no_evidence',
      mode: 'lexical_only',
    })
  })

  it('max(rrf) abaixo do mínimo: recusa no_evidence', async () => {
    const { retrieve } = setup({
      decision: decision('covered'),
      search: {
        mode: 'hybrid',
        evidence: [evidence(0.01, '2020-01-01', null)],
        stableKeys: [],
        reranked: false,
      },
      minEvidenceRrf: 0.02,
    })
    await expect(retrieve(ask)).resolves.toMatchObject({ reason: 'no_evidence' })
  })

  it('com evidência: busca só nas famílias cobertas e marca a fronteira dentro do PA', async () => {
    const controller = new AbortController()
    const found = [evidence(0.05, '2026-07-28', null)]
    const { retrieve, hybridSearch } = setup({
      decision: decision('partial', ['efd-go']),
      search: {
        mode: 'hybrid',
        evidence: found,
        stableKeys: ['go:rcte:art:76:par:8'],
        reranked: false,
      },
    })
    const result = await retrieve({ ...ask, signal: controller.signal })
    expect(result).toMatchObject({
      outcome: RetrievalOutcome.Evidence,
      mode: 'hybrid',
      evidence: found,
      uncoveredFamilies: ['efd-go'],
      stableKeys: ['go:rcte:art:76:par:8'],
      reference: { value: '2026-07-01', periodBoundaryInside: true, periodo: '2026-07' },
    })
    expect(hybridSearch).toHaveBeenCalledWith({
      question: ask.questionText,
      referenceDate: '2026-07-01',
      families: ['rcte'],
      signal: controller.signal,
    })
  })

  it('sem sinal, não passa signal à busca', async () => {
    const { retrieve, hybridSearch } = setup({
      decision: decision('covered'),
      search: {
        mode: 'hybrid',
        evidence: [evidence(0.05, '2004-11-04', '2009-11-23')],
        stableKeys: [],
        reranked: false,
      },
    })
    const result = await retrieve({ ...ask, input: { periodoApuracao: '2006-05' } })
    expect(result).toMatchObject({ reference: { periodBoundaryInside: false } })
    expect(hybridSearch.mock.calls[0]?.[0]).not.toHaveProperty('signal')
  })
})
