import { RefusalReason, RetrievalMode } from '@teko/shared/contracts'
import { containsDate, ReferenceSource } from '@teko/shared/vigencia'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '#adapters/out/persistence/drizzle/client.ts'
import { createPgSearchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-search-repository.ts'
import type { Container, RetrievalUseCases } from '#app/container.ts'
import { EmbeddingUnavailableError } from '#app/ports/embedding-port.ts'
import { createHybridSearch } from '#app/use-cases/hybrid-search.ts'
import { createRetrieveEvidence, RetrievalOutcome } from '#app/use-cases/retrieve-evidence.ts'
import { PUBLISHABLE_REVIEW_STATUSES } from '#domain/corpus/family.ts'
import { seedFixtureCorpus, testContainer } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Busca híbrida sobre a fixture única, com o runtime conectado como `teko_app` (só leitura no
 * corpus). Cenários do DoD da F2:
 * - pergunta em 05/2006, com só o snapshot 2026 do RCTE publicado, devolve a redação do Dec. 6.026;
 * - data posterior ao `verified_at` (2026-11-10) é recusada como `out_of_coverage`, sem busca;
 * - toda evidência está em vigor na data de referência.
 */

const RCTE_SNAPSHOT = 'RCTE consolidado até o Decreto nº 10.986, de 16.09.26'
const PARAGRAPH_6 = 'go:rcte:art:76:par:6'

let database: TestDatabase
let container: Container
let retrieval: RetrievalUseCases

beforeAll(async () => {
  database = await createTestDatabase()
  const written = await seedFixtureCorpus(database.ownerUrl)
  expect(written.chunks).toBeGreaterThan(1000)
  container = testContainer(database.appUrl)
  if (container.useCases.retrieval === null) {
    throw new Error('container sem retrieval')
  }
  retrieval = container.useCases.retrieval
}, 120_000)

afterAll(async () => {
  await container?.close()
  await database?.drop()
})

describe('redação na data, a partir de um snapshot consolidado posterior', () => {
  it('em 05/2006 devolve o § 6º do art. 76 na redação do Dec. 6.026, citando o snapshot de 2026', async () => {
    const result = await retrieval.retrieveEvidence({
      input: { periodoApuracao: '2006-05' },
      source: ReferenceSource.PeriodoApuracao,
      questionText:
        'Qual valor mínimo aplicado no GOYAZES ou no PROESPORTE permitia ao Secretário da Fazenda definir prazos diversos de pagamento do ICMS?',
      families: ['rcte'],
    })
    expect(result.outcome).toBe(RetrievalOutcome.Evidence)
    if (result.outcome !== RetrievalOutcome.Evidence) {
      return
    }
    expect(result.reference.value).toBe('2006-05-01')
    const paragraph = result.evidence.find((item) => item.stableKey === PARAGRAPH_6)
    expect(paragraph).toBeDefined()
    expect(paragraph?.validity).toEqual({ from: '2004-11-04', to: '2009-11-23' })
    expect(paragraph?.content).toContain('40.000,00')
    expect(paragraph?.document.versionLabel).toBe(RCTE_SNAPSHOT)
    for (const item of result.evidence) {
      expect(containsDate(item.validity, '2006-05-01')).toBe(true)
    }
  })

  it('o mesmo § 6º citado pela referência exata muda de redação conforme a data', async () => {
    const at = async (periodo: string) => {
      const result = await retrieval.retrieveEvidence({
        input: { periodoApuracao: periodo },
        source: ReferenceSource.PeriodoApuracao,
        questionText: 'O que diz o art. 76, § 6º do RCTE?',
        families: ['rcte'],
      })
      if (result.outcome !== RetrievalOutcome.Evidence) {
        throw new Error(`sem evidência em ${periodo}`)
      }
      return result.evidence.find((item) => item.stableKey === PARAGRAPH_6)
    }
    expect((await at('2004-03'))?.validity).toEqual({ from: '2003-09-12', to: '2004-11-04' })
    expect((await at('2006-05'))?.validity).toEqual({ from: '2004-11-04', to: '2009-11-23' })
    const revoked = await at('2010-01')
    expect(revoked?.validity).toEqual({ from: '2009-11-23', to: null })
    expect(revoked?.content).toContain('Revogado')
  })
})

describe('cobertura', () => {
  it('recusa data posterior ao verified_at como out_of_coverage, com os intervalos cobertos', async () => {
    const result = await retrieval.retrieveEvidence({
      input: { referenceDate: '2026-11-15' },
      source: ReferenceSource.Explicit,
      questionText: 'Qual o prazo de pagamento do ICMS na importação?',
      families: ['rcte'],
    })
    expect(result.outcome).toBe(RetrievalOutcome.Refused)
    if (result.outcome !== RetrievalOutcome.Refused) {
      return
    }
    expect(result.reason).toBe(RefusalReason.OutOfCoverage)
    expect(result.mode).toBeNull()
    expect(result.coverage).toEqual([
      {
        family: 'rcte',
        jurisdiction: 'GO',
        covered: [{ from: '1998-01-01', to: '2026-11-11' }],
        verifiedAt: '2026-11-10',
      },
    ])
  })

  it('aceita a própria data do verified_at', async () => {
    const result = await retrieval.retrieveEvidence({
      input: { referenceDate: '2026-11-10' },
      source: ReferenceSource.Explicit,
      questionText: 'Qual o prazo de pagamento do ICMS na importação?',
      families: ['rcte'],
    })
    expect(result.outcome).toBe(RetrievalOutcome.Evidence)
  })

  it('recusa os Anexos do RCTE (onda C3) por falta de cobertura', async () => {
    const result = await retrieval.retrieveEvidence({
      input: { periodoApuracao: '2026-03' },
      source: ReferenceSource.PeriodoApuracao,
      questionText: 'Qual a MVA da substituição tributária de cimento no Anexo VIII?',
      families: ['rcte-anexos'],
    })
    expect(result).toMatchObject({
      outcome: RetrievalOutcome.Refused,
      reason: RefusalReason.OutOfCoverage,
    })
  })

  it('com cobertura parcial busca só nas famílias cobertas e informa as demais', async () => {
    const result = await retrieval.retrieveEvidence({
      input: { periodoApuracao: '2024-06' },
      source: ReferenceSource.PeriodoApuracao,
      questionText: 'Qual o prazo de pagamento do ICMS nas operações com regime especial?',
      families: ['rcte', 'efd-icms-ipi'],
    })
    expect(result.outcome).toBe(RetrievalOutcome.Evidence)
    if (result.outcome !== RetrievalOutcome.Evidence) {
      return
    }
    expect(result.uncoveredFamilies).toEqual(['efd-icms-ipi'])
    expect(result.evidence.every((item) => item.family === 'rcte')).toBe(true)
  })
})

describe('degradação', () => {
  it('sem embedding da pergunta, roda lexical_only e continua filtrando por vigência', async () => {
    const database2 = createDatabase({ url: database.appUrl, applicationName: 'teko-test' })
    try {
      const failing = {
        model: 'indisponível',
        dimensions: 1024,
        embed: () => Promise.reject(new EmbeddingUnavailableError('fora do ar')),
      }
      const retrieve = createRetrieveEvidence({
        resolveReferenceDate: container.useCases.resolveReferenceDate,
        checkCoverage: retrieval.checkCoverage,
        hybridSearch: createHybridSearch({
          embeddings: failing,
          searchRepository: createPgSearchRepository(database2.pool),
          reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
          embeddingTimeoutMs: 3000,
          limit: 12,
        }),
        minEvidenceRrf: 0,
      })
      const result = await retrieve({
        input: { periodoApuracao: '2006-05' },
        source: ReferenceSource.PeriodoApuracao,
        questionText: 'GOYAZES PROESPORTE prazos diversos Secretário da Fazenda',
        families: ['rcte'],
      })
      expect(result.outcome).toBe(RetrievalOutcome.Evidence)
      if (result.outcome !== RetrievalOutcome.Evidence) {
        return
      }
      expect(result.mode).toBe(RetrievalMode.LexicalOnly)
      expect(result.evidence.map((item) => item.stableKey)).toContain(PARAGRAPH_6)
      expect(result.evidence.every((item) => item.semanticRank === null)).toBe(true)
      expect(result.evidence.every((item) => containsDate(item.validity, '2006-05-01'))).toBe(true)
    } finally {
      await database2.close()
    }
  })

  it('pergunta sem nenhum termo conhecido nem referência é recusada como no_evidence no modo léxico', async () => {
    const database2 = createDatabase({ url: database.appUrl, applicationName: 'teko-test' })
    try {
      const hybridSearch = createHybridSearch({
        embeddings: {
          model: 'indisponível',
          dimensions: 1024,
          embed: () => Promise.reject(new EmbeddingUnavailableError('fora do ar')),
        },
        searchRepository: createPgSearchRepository(database2.pool),
        reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
        embeddingTimeoutMs: 3000,
        limit: 12,
      })
      const result = await createRetrieveEvidence({
        resolveReferenceDate: container.useCases.resolveReferenceDate,
        checkCoverage: retrieval.checkCoverage,
        hybridSearch,
        minEvidenceRrf: 0,
      })({
        input: { periodoApuracao: '2006-05' },
        source: ReferenceSource.PeriodoApuracao,
        questionText: 'xyzzy plugh',
        families: ['rcte'],
      })
      expect(result).toMatchObject({
        outcome: RetrievalOutcome.Refused,
        reason: RefusalReason.NoEvidence,
        mode: RetrievalMode.LexicalOnly,
      })
    } finally {
      await database2.close()
    }
  })
})

describe('busca léxica', () => {
  it('ignora acentos (immutable_unaccent no tsv e na pergunta)', async () => {
    const result = await retrieval.hybridSearch({
      question: 'goyazes proesporte secretario fazenda prazos diversos',
      referenceDate: '2006-05-01',
      families: ['rcte'],
    })
    expect(
      result.evidence.find((item) => item.stableKey === PARAGRAPH_6)?.lexicalRank,
    ).not.toBeNull()
  })
})
