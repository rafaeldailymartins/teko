import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFixtureDocuments } from '../../src/adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import { tempDir } from '../../test/setup/temp-dir.ts'
import { devTests, holdoutTests, metricsFor, toPromptfooTest } from './golden-tests.ts'
import { GoldenSplit, goldenPath, loadGolden } from './load-golden.ts'
import { goldenCaseSchema, goldenDatasetSchema } from './schema.ts'

const base = {
  id: 'caso',
  question: 'Pergunta?',
  reference_date: '2006-05-01',
  reference_source: 'explicit',
  locale: 'pt-BR',
  expected: { status: 'answered', provisions: ['go:rcte:art:76'] },
  tags: ['rcte'],
  source_url: 'https://example.test',
  source_quote: 'x',
  curated_by: 'teste',
  reviewed_at: null,
} as const

function issues(value: unknown, schema = goldenCaseSchema): string[] {
  const result = schema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('schema do golden', () => {
  it('exige exatamente uma forma de data e os campos de cada status', () => {
    expect(issues(base)).toEqual([])
    expect(issues({ ...base, periodo_apuracao: '2006-05' })).toEqual([
      'informe exatamente um entre reference_date e periodo_apuracao',
    ])
    expect(issues({ ...base, expected: { status: 'answered' } })).toEqual([
      'answered exige ao menos um dispositivo',
    ])
    expect(issues({ ...base, expected: { status: 'refused' } })).toEqual([
      'refused exige refusal_reason',
    ])
    expect(issues({ ...base, expected: { status: 'needs_clarification' } })).toEqual([
      'needs_clarification exige candidates',
    ])
    expect(issues({ ...base, expected: { status: 'answered', provisions: ['x:y'] } })).toEqual([
      'stable_key inválida',
    ])
    expect(issues({ ...base, expected: { status: 'unanswerable' } })).toEqual([])
    expect(
      issues({ ...base, expected: { status: 'unanswerable', provisions: ['go:rcte:art:76'] } }),
    ).toEqual(['unanswerable não tem dispositivo esperado'])
  })

  it('ids repetidos no dataset são erro', () => {
    expect(issues([base, base], goldenDatasetSchema as never)).toEqual(['id repetido: caso'])
  })
})

describe('golden versionado', () => {
  const cases = loadGolden()

  it('tem 50 casos na distribuição do plano, todos revisados pelo mantenedor', () => {
    expect(cases).toHaveLength(50)
    const byStatus = Object.groupBy(cases, (golden) => golden.expected.status)
    expect(byStatus.refused).toHaveLength(6)
    expect(byStatus.needs_clarification).toHaveLength(4)
    expect(cases.every((golden) => golden.reviewed_at !== null)).toBe(true)
  })

  it('toda stable_key esperada existe na fixture', () => {
    const keys = new Set(
      loadFixtureDocuments('test/fixtures/corpus').flatMap((doc) =>
        doc.provisions.map((p) => p.stableKey),
      ),
    )
    const missing = cases
      .flatMap((golden) => golden.expected.provisions)
      .filter((key) => !keys.has(key))
    expect(missing).toEqual([])
  })

  it('lê um arquivo arbitrário com o mesmo schema', () => {
    const file = join(tempDir('teko-golden-'), 'g.yaml')
    writeFileSync(file, '- id: um\n  question: q\n')
    expect(() => loadGolden(file)).toThrow()
  })
})

describe('holdout versionado (ADR 0031)', () => {
  const dev = loadGolden(goldenPath(GoldenSplit.Dev))
  const holdout = loadGolden(goldenPath(GoldenSplit.Holdout))

  it('tem de 40 a 60 casos novos, de todos os status, com perguntas em inglês', () => {
    expect(holdout.length).toBeGreaterThanOrEqual(40)
    expect(holdout.length).toBeLessThanOrEqual(60)
    const byStatus = Object.groupBy(holdout, (golden) => golden.expected.status)
    for (const status of ['answered', 'refused', 'needs_clarification', 'unanswerable']) {
      expect(byStatus[status as keyof typeof byStatus]?.length ?? 0).toBeGreaterThan(0)
    }
    expect(holdout.filter((golden) => golden.locale === 'en').length).toBeGreaterThanOrEqual(5)
    expect(
      holdout.filter((golden) => golden.expected.provisions.length > 1).length,
    ).toBeGreaterThanOrEqual(5)
  })

  it('não repete id nem pergunta do dev', () => {
    const ids = new Set(dev.map((golden) => golden.id))
    const questions = new Set(dev.map((golden) => golden.question.trim().toLowerCase()))
    expect(holdout.filter((golden) => ids.has(golden.id))).toEqual([])
    expect(holdout.filter((golden) => questions.has(golden.question.trim().toLowerCase()))).toEqual(
      [],
    )
  })

  it('o gerador do holdout cobre o arquivo inteiro', async () => {
    const tests = await holdoutTests()
    expect(tests.map((test) => test.description)).toEqual(holdout.map((golden) => golden.id))
  })
})

describe('testes do promptfoo gerados do golden', () => {
  it('cada status recebe só as métricas que se aplicam', () => {
    const answered = goldenCaseSchema.parse(base)
    expect(metricsFor(answered)).toEqual(['recall@10', 'mrr', 'vigencia'])
    expect(
      metricsFor(
        goldenCaseSchema.parse({
          ...base,
          expected: {
            status: 'refused',
            refusal_reason: 'out_of_coverage',
            reference_date: '2006-05-01',
          },
        }),
      ),
    ).toEqual(['recusa', 'data_referencia'])
    expect(
      metricsFor(
        goldenCaseSchema.parse({
          ...base,
          expected: { status: 'needs_clarification', candidates: ['2006-05-01', '2010-01-01'] },
        }),
      ),
    ).toEqual(['clarificacao'])
    expect(
      metricsFor(
        goldenCaseSchema.parse({
          ...base,
          expected: { status: 'unanswerable', reference_date: '2006-05-01' },
        }),
      ),
    ).toEqual(['sem_resposta', 'data_referencia'])
    expect(toPromptfooTest(goldenCaseSchema.parse({ ...base, pair: 'p' }))).toEqual({
      description: 'caso',
      vars: { question: 'Pergunta?', golden: goldenCaseSchema.parse({ ...base, pair: 'p' }) },
      assert: [
        { type: 'javascript', value: 'file://../asserts/recall-at-k.ts', metric: 'recall@10' },
        { type: 'javascript', value: 'file://../asserts/mrr.ts', metric: 'mrr' },
        { type: 'javascript', value: 'file://../asserts/validity.ts', metric: 'vigencia' },
      ],
      metadata: { tags: ['rcte'], pair: 'p' },
    })
    expect(toPromptfooTest(answered).metadata.pair).toBeNull()
  })

  it('o gerador padrão cobre o golden inteiro', async () => {
    const tests = await devTests()
    expect(tests).toHaveLength(50)
    expect(new Set(tests.map((test) => test.description)).size).toBe(50)
  })
})
