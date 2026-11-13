import { RefusalReason, RetrievalMode } from '@teko/shared/contracts'
import { containsDate, hasBoundaryInsidePeriod, ReferenceSource } from '@teko/shared/vigencia'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { createPgSearchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-search-repository.ts'
import { BEGIN_HYBRID_SEARCH } from '#adapters/out/persistence/drizzle/sql/hybrid-search.ts'
import type { Container, RetrievalUseCases } from '#app/container.ts'
import { EmbeddingUnavailableError } from '#app/ports/embedding-port.ts'
import { createFindPeriodVersions } from '#app/use-cases/find-period-versions.ts'
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
/** Pool próprio como `teko_app`, para chamar o repositório direto. */
let appDatabase: Database

beforeAll(async () => {
  database = await createTestDatabase()
  const written = await seedFixtureCorpus(database.ownerUrl)
  expect(written.chunks).toBeGreaterThan(1000)
  container = testContainer(database.appUrl)
  if (container.useCases.retrieval === null) {
    throw new Error('container sem retrieval')
  }
  retrieval = container.useCases.retrieval
  appDatabase = createDatabase({ url: database.appUrl, applicationName: 'teko-test' })
}, 120_000)

afterAll(async () => {
  await appDatabase?.close()
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

  it('a vigência não perde um dia quando o processo roda a leste de UTC', async () => {
    // O parser padrão do `pg` faz `date` virar `Date` à meia-noite local; em Tóquio (UTC+9), o
    // `toISOString()` dessa meia-noite ainda é o dia anterior.
    const original = process.env['TZ']
    process.env['TZ'] = 'Asia/Tokyo'
    try {
      const result = await retrieval.hybridSearch({
        question: 'O que diz o art. 76, § 6º do RCTE?',
        referenceDate: '2006-05-01',
        families: ['rcte'],
      })
      expect(result.evidence.find((item) => item.stableKey === PARAGRAPH_6)?.validity).toEqual({
        from: '2004-11-04',
        to: '2009-11-23',
      })
    } finally {
      if (original === undefined) {
        delete process.env['TZ']
      } else {
        process.env['TZ'] = original
      }
    }
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
          reranker: null,
          rerankCandidates: 30,
          rerankTimeoutMs: 2000,
        }),
        findPeriodVersions: () => Promise.resolve([]),
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
        reranker: null,
        rerankCandidates: 30,
        rerankTimeoutMs: 2000,
      })
      const result = await createRetrieveEvidence({
        resolveReferenceDate: container.useCases.resolveReferenceDate,
        checkCoverage: retrieval.checkCoverage,
        hybridSearch,
        findPeriodVersions: () => Promise.resolve([]),
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

describe('fronteira de vigência dentro do PA', () => {
  // CTE, art. 47: em 01/12/2005 só o caput está em vigor; os §§ 1º a 3º (e incisos) foram
  // acrescentados com vigência a partir de 29/12/2005. A busca roda no dia 1 e não os enxerga.
  const ART_47 = 'go:cte:art:47'

  it('o repositório acha as vigências que começam no meio do mês na unidade da evidência', async () => {
    const repository = createPgSearchRepository(appDatabase.pool)
    const versions = await repository.versionsInPeriod({
      period: { from: '2005-12-01', to: '2006-01-01' },
      scopes: [ART_47],
      families: ['cte'],
      reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
    })
    expect(versions).toContainEqual({ from: '2005-12-29', to: null })
    for (const version of versions) {
      expect(hasBoundaryInsidePeriod('2005-12', [version])).toBe(true)
    }
    const otherFamily = await repository.versionsInPeriod({
      period: { from: '2005-12-01', to: '2006-01-01' },
      scopes: [ART_47],
      families: ['rcte'],
      reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
    })
    expect(otherFamily).toEqual([])
  })

  /**
   * `RetrieveEvidence` real (cobertura, busca e fronteiras no banco), no modo léxico: a pergunta
   * não está na fixture de embeddings, e o braço `exact` acha o art. 47 pela referência citada.
   */
  function lexicalRetrieve() {
    const repository = createPgSearchRepository(appDatabase.pool)
    return createRetrieveEvidence({
      resolveReferenceDate: container.useCases.resolveReferenceDate,
      checkCoverage: retrieval.checkCoverage,
      hybridSearch: createHybridSearch({
        embeddings: {
          model: 'indisponível',
          dimensions: 1024,
          embed: () => Promise.reject(new EmbeddingUnavailableError('fora do ar')),
        },
        searchRepository: repository,
        reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
        embeddingTimeoutMs: 3000,
        limit: 12,
        reranker: null,
        rerankCandidates: 40,
        rerankTimeoutMs: 3000,
      }),
      findPeriodVersions: createFindPeriodVersions({
        searchRepository: repository,
        reviewStatuses: PUBLISHABLE_REVIEW_STATUSES,
      }),
      minEvidenceRrf: 0,
    })
  }

  it('avisa a fronteira do dispositivo acrescentado no meio do PA, ausente da evidência', async () => {
    const result = await lexicalRetrieve()({
      input: { periodoApuracao: '2005-12' },
      source: ReferenceSource.PeriodoApuracao,
      questionText: 'O que diz o art. 47 do CTE?',
      families: ['cte'],
    })
    if (result.outcome !== RetrievalOutcome.Evidence) {
      throw new Error(`sem evidência: ${result.outcome}`)
    }
    expect(result.evidence.map((item) => item.stableKey)).toContain(ART_47)
    // Antes, só as vigências da evidência contavam, e nenhuma tem fronteira em 12/2005.
    expect(
      hasBoundaryInsidePeriod(
        '2005-12',
        result.evidence.map((item) => item.validity),
      ),
    ).toBe(false)
    expect(result.reference.periodBoundaryInside).toBe(true)
  })

  it('data exata (fora de PA) não consulta fronteiras', async () => {
    const result = await lexicalRetrieve()({
      input: { referenceDate: '2005-12-01' },
      source: ReferenceSource.Explicit,
      questionText: 'O que diz o art. 47 do CTE?',
      families: ['cte'],
    })
    expect(result).toMatchObject({ reference: { periodBoundaryInside: false, periodo: null } })
  })
})

describe('ajustes do HNSW', () => {
  it('vão junto do BEGIN, numa ida ao banco, e valem só dentro da transação', async () => {
    const client = new pg.Client({ connectionString: database.appUrl })
    await client.connect()
    const settings = `SELECT current_setting('hnsw.ef_search', true) AS ef,
      current_setting('hnsw.iterative_scan', true) AS scan,
      current_setting('hnsw.max_scan_tuples', true) AS tuples`
    try {
      await client.query(BEGIN_HYBRID_SEARCH)
      expect((await client.query(settings)).rows[0]).toEqual({
        ef: '100',
        scan: 'relaxed_order',
        tuples: '20000',
      })
      await client.query('COMMIT')
      expect((await client.query(settings)).rows[0]?.ef).not.toBe('100')
    } finally {
      await client.end()
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

describe('um resultado por dispositivo', () => {
  // O registro C100 da fixture tem três chunks por versão (a página do registro, com a tabela de
  // campos). Antes, eles ocupavam as três primeiras vagas e empurravam o campo perguntado.
  it('o registro de vários chunks aparece uma vez, com os votos somados, e o campo sobe', async () => {
    // Pergunta do caso efd-c100-codsit-2025 do golden (o embedding está na fixture).
    const result = await retrieval.hybridSearch({
      question:
        'Quais códigos de situação do documento são aceitos no registro C100 da nota fiscal?',
      referenceDate: '2025-09-01',
      families: ['efd-icms-ipi'],
    })
    const keys = result.evidence.map((item) => item.stableKey)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((key) => key === 'br:efd-icms-ipi:reg:C100')).toHaveLength(1)
    expect(keys.slice(0, 10)).toContain('br:efd-icms-ipi:reg:C100:campo:06')
  })
})
