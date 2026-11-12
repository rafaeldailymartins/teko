import { describe, expect, it } from 'vitest'
import { type GoldenCase, goldenCaseSchema } from '../datasets/schema.ts'
import { evaluateMetric, makeAssert } from './assert-factory.ts'
import {
  clarificationCorrect,
  describeMissing,
  type RetrievalOutput,
  rankedProvisions,
  recallAtK,
  reciprocalRank,
  referenceDateCorrect,
  refusalCorrect,
  validityCorrect,
} from './metrics.ts'

const P6 = 'go:rcte:art:76:par:6'
const P5 = 'go:rcte:art:76:par:5'

function golden(
  expected: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): GoldenCase {
  return goldenCaseSchema.parse({
    id: 'caso',
    question: 'Qual a redação do § 6º?',
    periodo_apuracao: '2006-05',
    reference_source: 'periodo_apuracao',
    locale: 'pt-BR',
    expected,
    tags: ['rcte'],
    source_url: 'https://example.test',
    source_quote: '§ 6º',
    curated_by: 'teste',
    reviewed_at: null,
    ...extra,
  })
}

const answered = golden({
  status: 'answered',
  reference_date: '2006-05-01',
  provisions: [P6],
  validity: { from: '2004-11-04', to: '2009-11-23' },
})

function hit(stableKey: string, from = '2004-11-04', to: string | null = '2009-11-23') {
  return { stableKey, validity: { from, to }, versionLabel: 'RCTE 2026', rrf: 0.03 }
}

function output(overrides: Partial<RetrievalOutput> = {}): RetrievalOutput {
  return {
    outcome: 'evidence',
    reason: null,
    referenceDate: '2006-05-01',
    candidates: [],
    mode: 'hybrid',
    hits: [],
    ...overrides,
  }
}

describe('métricas de recuperação', () => {
  it('o motivo do recall diz o estado no banco do dispositivo que faltou', () => {
    const base = output({ hits: [hit(P5)] })
    const withDiagnostics = (
      versions: { reviewStatus: string; chunks: number; embedded: number }[],
    ) => recallAtK(answered, { ...base, diagnostics: [{ stableKey: P6, versions }] }).reason
    expect(withDiagnostics([])).toBe(`0/1 no top-10; faltou: ${P6} (sem redação na data)`)
    expect(withDiagnostics([{ reviewStatus: 'pending', chunks: 2, embedded: 1 }])).toBe(
      `0/1 no top-10; faltou: ${P6} (pending, 1/2 chunks com embedding)`,
    )
    expect(describeMissing(base, P6)).toBe(P6)
  })

  it('conta dispositivos distintos, na ordem', () => {
    expect(rankedProvisions(output({ hits: [hit(P5), hit(P5), hit(P6)] }))).toEqual([P5, P6])
  })

  it('recall@10 e MRR sobre dispositivos distintos', () => {
    const found = output({ hits: [hit(P5), hit(P5), hit(P5), hit(P6)] })
    expect(recallAtK(answered, found)).toEqual({ score: 1, reason: '1/1 no top-10; faltou: nada' })
    expect(reciprocalRank(answered, found)).toEqual({
      score: 0.5,
      reason: 'primeiro esperado na posição 2',
    })
    const missing = output({ hits: [hit(P5)] })
    expect(recallAtK(answered, missing)).toEqual({
      score: 0,
      reason: `0/1 no top-10; faltou: ${P6}`,
    })
    expect(reciprocalRank(answered, missing)).toEqual({
      score: 0,
      reason: 'nenhum esperado nos resultados',
    })
    expect(recallAtK(answered, found, 1).score).toBe(0)
  })

  it('vigência: todos em vigor na data e a redação esperada exata', () => {
    expect(validityCorrect(answered, output({ hits: [hit(P6)] }))).toEqual({
      score: 1,
      reason: 'redação esperada',
    })
    expect(validityCorrect(answered, output({ hits: [hit(P6, '2009-11-23', null)] })).score).toBe(0)
    expect(
      validityCorrect(answered, output({ hits: [hit(P6), hit(P5, '2003-09-12', '2004-11-04')] })),
    ).toEqual({ score: 0, reason: `fora da vigência em 2006-05-01: ${P5}` })
    expect(validityCorrect(answered, output({ hits: [hit(P5)] })).score).toBeNull()
    const noValidity = golden({ status: 'answered', provisions: [P6] })
    expect(validityCorrect(noValidity, output({ hits: [hit(P5)] }))).toEqual({
      score: 1,
      reason: 'todos os resultados em vigor na data',
    })
    expect(validityCorrect(answered, output({ referenceDate: null })).score).toBeNull()
  })

  it('recusa e clarificação exigem o resultado exato', () => {
    const refused = golden({ status: 'refused', refusal_reason: 'out_of_coverage' })
    expect(
      refusalCorrect(refused, output({ outcome: 'refused', reason: 'out_of_coverage' })).score,
    ).toBe(1)
    expect(
      refusalCorrect(refused, output({ outcome: 'refused', reason: 'no_evidence' })).score,
    ).toBe(0)
    expect(refusalCorrect(answered, output()).score).toBeNull()

    const ambiguous = golden({
      status: 'needs_clarification',
      candidates: ['2010-01-01', '2004-03-01'],
    })
    expect(
      clarificationCorrect(
        ambiguous,
        output({ outcome: 'needs_clarification', candidates: ['2004-03-01', '2010-01-01'] }),
      ).score,
    ).toBe(1)
    expect(clarificationCorrect(ambiguous, output({ outcome: 'evidence' })).score).toBe(0)
    expect(clarificationCorrect(answered, output()).score).toBeNull()
  })

  it('data de referência resolvida', () => {
    expect(referenceDateCorrect(answered, output()).score).toBe(1)
    expect(referenceDateCorrect(answered, output({ referenceDate: '2006-05-17' })).score).toBe(0)
    expect(
      referenceDateCorrect(golden({ status: 'answered', provisions: [P6] }), output()).score,
    ).toBeNull()
  })

  it('recall e MRR não se aplicam fora de answered', () => {
    const refused = golden({ status: 'refused', refusal_reason: 'out_of_coverage' })
    expect(recallAtK(refused, output()).score).toBeNull()
    expect(reciprocalRank(refused, output()).score).toBeNull()
  })
})

describe('asserts do promptfoo', () => {
  const vars = { golden: answered }

  it('devolvem score e o nome da métrica em namedScores', () => {
    const json = JSON.stringify(output({ hits: [hit(P5), hit(P6)] }))
    expect(makeAssert('mrr')(json, { vars })).toEqual({
      pass: true,
      score: 0.5,
      reason: 'primeiro esperado na posição 2',
      namedScores: { mrr: 0.5 },
    })
    expect(evaluateMetric('vigencia', json, { vars })).toMatchObject({ pass: true, score: 1 })
    expect(evaluateMetric('recall@10', JSON.stringify(output()), { vars })).toMatchObject({
      pass: false,
      score: 0,
    })
    expect(
      evaluateMetric('data_referencia', JSON.stringify(output({ referenceDate: 'x' })), { vars }),
    ).toMatchObject({ pass: false, score: 0 })
  })

  it('saída inválida reprova; métrica que não se aplica passa sem nota', () => {
    expect(evaluateMetric('mrr', JSON.stringify({ outcome: 'x' }), { vars })).toEqual({
      pass: false,
      score: 0,
      reason: 'saída do provider inválida',
      namedScores: { mrr: 0 },
    })
    expect(evaluateMetric('recusa', JSON.stringify(output()), { vars })).toEqual({
      pass: true,
      score: 1,
      reason: 'n/a: caso não é de recusa',
      namedScores: {},
    })
  })
})
