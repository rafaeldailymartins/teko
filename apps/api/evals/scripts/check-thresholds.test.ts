import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkSuite,
  evaluateThresholds,
  loadThresholds,
  meanInterval,
  parseThresholds,
  renderSummary,
  wilsonInterval,
} from './check-thresholds.ts'

function result(
  description: string,
  components: { metric?: string; score: number; reason?: string }[],
  extra = {},
) {
  return {
    testCase: { description },
    gradingResult: {
      componentResults: components.map(({ metric, score, reason }) => ({
        score,
        ...(reason === undefined ? {} : { reason }),
        assertion: metric === undefined ? null : { metric },
      })),
    },
    ...extra,
  }
}

const output = {
  results: {
    results: [
      result('a', [{ metric: 'mrr', score: 1 }, { metric: 'recall@10', score: 1 }, { score: 0.2 }]),
      result('b', [
        { metric: 'mrr', score: 0.5, reason: 'posição 2' },
        { metric: 'recall@10', score: 0 },
      ]),
    ],
  },
}

describe('intervalos de confiança', () => {
  it('Wilson: proporção dentro de [0, 1], mais largo com menos casos', () => {
    const small = wilsonInterval(0.9, 10)
    const large = wilsonInterval(0.9, 100)
    expect(small.low).toBeCloseTo(0.5958, 3)
    expect(small.high).toBeCloseTo(0.9821, 3)
    expect(large.high - large.low).toBeLessThan(small.high - small.low)
    expect(wilsonInterval(1, 50).high).toBeCloseTo(1, 12)
    expect(wilsonInterval(1, 50).low).toBeCloseTo(0.9287, 3)
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 })
  })

  it('média ± 1,96 erro-padrão, limitada a [0, 1]', () => {
    const interval = meanInterval([1, 0.5])
    expect(interval.low).toBeCloseTo(0.75 - 1.959964 * 0.25, 6)
    expect(interval.high).toBe(1)
    expect(meanInterval([0.4])).toEqual({ low: 0.4, high: 0.4 })
    expect(meanInterval([])).toEqual({ low: 0, high: 1 })
  })
})

describe('evaluateThresholds', () => {
  it('média por métrica, com intervalo e os casos abaixo de 1', () => {
    const report = evaluateThresholds(output, { mrr: 0.7, 'recall@10': 0.9 }, { mrr: 0.8 })
    expect(report.metrics).toEqual([
      {
        metric: 'mrr',
        mean: 0.75,
        cases: 2,
        ci: meanInterval([1, 0.5]),
        threshold: 0.7,
        target: 0.8,
        pass: true,
        failures: ['b: posição 2'],
      },
      {
        metric: 'recall@10',
        mean: 0.5,
        cases: 2,
        ci: wilsonInterval(0.5, 2),
        threshold: 0.9,
        target: null,
        pass: false,
        failures: ['b: score 0'],
      },
    ])
    expect(report.pass).toBe(false)
  })

  it('limite null é informativo: não reprova, mas exige casos', () => {
    const report = evaluateThresholds(output, { 'recall@10': null, recusa: null })
    expect(report.metrics.map((m) => [m.metric, m.pass])).toEqual([
      ['recall@10', true],
      ['recusa', false],
    ])
    expect(evaluateThresholds(output, { 'recall@10': null }).pass).toBe(true)
  })

  it('métrica sem casos reprova; erro do provider reprova; falha de assert não é erro', () => {
    expect(evaluateThresholds(output, { recusa: 1 }).metrics[0]).toMatchObject({
      cases: 0,
      pass: false,
    })
    const withError = {
      results: {
        results: [
          result('c', [{ metric: 'mrr', score: 1 }], {
            failureReason: 2,
            error: 'conexão recusada',
          }),
          result('d', [{ metric: 'mrr', score: 0 }], { failureReason: 1, error: 'assert falhou' }),
          { description: 'e', gradingResult: null },
          {},
        ],
      },
    }
    const report = evaluateThresholds(withError, { mrr: 0 })
    expect(report.errors).toEqual(['c: conexão recusada'])
    expect(report.pass).toBe(false)
    expect(evaluateThresholds(output, { mrr: 0.75 }).pass).toBe(true)
  })

  it('rejeita saída fora do formato do promptfoo', () => {
    expect(() => evaluateThresholds({ results: [] }, { mrr: 1 })).toThrow()
  })
})

describe('renderSummary', () => {
  it('tabela em markdown com intervalo, gate e meta; casos abaixo de 1 e erros', () => {
    const report = evaluateThresholds(output, { mrr: 0.7, 'recall@10': null }, { mrr: 0.8 })
    const summary = renderSummary('Evals (retrieval)', report)
    expect(summary).toContain('### Evals (retrieval): aprovado')
    expect(summary).toContain('| Métrica | Média | IC 95% | Gate | Meta | Casos | |')
    expect(summary).toContain('| mrr | 0.750 | 0.260–1.000 | 0.70 | 0.80 | 2 | ok |')
    expect(summary).toMatch(
      /\| recall@10 \| 0\.500 \| [0-9.]+–[0-9.]+ \| — \| — \| 2 \| informativa \|/,
    )
    expect(summary).toContain('- `mrr` b: posição 2')
    const failed = renderSummary('X', { metrics: [], errors: ['c: erro'], pass: false })
    expect(failed).toContain('### X: REPROVADO')
    expect(failed).toContain('**Erros do provider:**\n- c: erro')
    expect(failed).not.toContain('<details>')
  })
})

describe('thresholds.json', () => {
  const file = loadThresholds()

  it('lê suítes, comentários e metas', () => {
    expect(
      parseThresholds({ $comment: 'x', a: { mrr: 0.5, recall: null }, metas: { a: { mrr: 0.7 } } }),
    ).toEqual({ suites: { a: { mrr: 0.5, recall: null } }, metas: { a: { mrr: 0.7 } } })
    expect(() => parseThresholds({ a: { mrr: 2 } })).toThrow()
  })

  it('o corpus-eval (dev) tem as mesmas métricas da fixture, sem afrouxar recall, vigência e recusa', () => {
    const fixture = file.suites['retrieval'] ?? {}
    const corpus = file.suites['retrieval-corpus'] ?? {}
    expect(Object.keys(corpus).sort()).toEqual(Object.keys(fixture).sort())
    for (const metric of ['recall@10', 'vigencia', 'recusa', 'clarificacao', 'data_referencia']) {
      expect(corpus[metric]).toBeGreaterThanOrEqual(fixture[metric] ?? Number.POSITIVE_INFINITY)
    }
    // MRR do corpus real: trava no nível medido (ADR 0027), abaixo da meta de 0,70 da fixture.
    expect(corpus['mrr']).toBe(0.65)
  })

  it('o holdout trava as métricas determinísticas e leva a meta de MRR da F4 (ADR 0031)', () => {
    const holdout = file.suites['retrieval-holdout'] ?? {}
    for (const metric of [
      'vigencia',
      'recusa',
      'clarificacao',
      'data_referencia',
      'sem_resposta',
    ]) {
      expect(holdout[metric]).toBe(1)
    }
    expect(file.metas['retrieval-holdout']?.['mrr']).toBe(0.7)
  })

  it('checkSuite lê o arquivo do promptfoo e recusa suíte desconhecida', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'teko-thresholds-')), 'out.json')
    writeFileSync(path, JSON.stringify(output))
    expect(checkSuite(path, 'x', { suites: { x: { mrr: 0.7 } }, metas: {} }).pass).toBe(true)
    expect(() => checkSuite(path, 'y', file)).toThrow('suite desconhecida')
  })
})
