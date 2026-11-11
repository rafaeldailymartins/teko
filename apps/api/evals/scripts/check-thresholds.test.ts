import { describe, expect, it } from 'vitest'
import { evaluateThresholds, renderSummary } from './check-thresholds.ts'

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

describe('evaluateThresholds', () => {
  it('média por métrica, com os casos abaixo de 1', () => {
    const report = evaluateThresholds(output, { mrr: 0.7, 'recall@10': 0.9 })
    expect(report.metrics).toEqual([
      {
        metric: 'mrr',
        mean: 0.75,
        cases: 2,
        threshold: 0.7,
        pass: true,
        failures: ['b: posição 2'],
      },
      {
        metric: 'recall@10',
        mean: 0.5,
        cases: 2,
        threshold: 0.9,
        pass: false,
        failures: ['b: score 0'],
      },
    ])
    expect(report.pass).toBe(false)
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
  it('tabela em markdown, casos abaixo de 1 e erros', () => {
    const report = evaluateThresholds(output, { mrr: 0.7 })
    const summary = renderSummary('Evals (retrieval)', report)
    expect(summary).toContain('### Evals (retrieval): aprovado')
    expect(summary).toContain('| mrr | 0.750 | 0.70 | 2 | ok |')
    expect(summary).toContain('- `mrr` b: posição 2')
    const failed = renderSummary('X', { metrics: [], errors: ['c: erro'], pass: false })
    expect(failed).toContain('### X: REPROVADO')
    expect(failed).toContain('**Erros do provider:**\n- c: erro')
    expect(failed).not.toContain('<details>')
  })
})
