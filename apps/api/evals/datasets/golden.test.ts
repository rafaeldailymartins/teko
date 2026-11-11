import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFixtureDocuments } from '../../src/adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import generateTests, { metricsFor, toPromptfooTest } from './golden-tests.ts'
import { loadGolden } from './load-golden.ts'
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
    const file = join(mkdtempSync(join(tmpdir(), 'teko-golden-')), 'g.yaml')
    writeFileSync(file, '- id: um\n  question: q\n')
    expect(() => loadGolden(file)).toThrow()
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
    const tests = await generateTests()
    expect(tests).toHaveLength(50)
    expect(new Set(tests.map((test) => test.description)).size).toBe(50)
  })
})
