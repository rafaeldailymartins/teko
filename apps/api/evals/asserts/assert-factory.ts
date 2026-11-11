import { type GoldenCase, goldenCaseSchema } from '../datasets/schema.ts'
import { METRICS, type MetricName, retrievalOutputSchema } from './metrics.ts'

/**
 * Invólucro de uma métrica como assert `javascript` do promptfoo (`file://asserts/<métrica>.ts`).
 * O caso golden chega em `context.vars.golden`; o `output` é o JSON do provider `retrieval.ts`.
 * O resultado carrega `namedScores` com o nome da métrica, que o `check-thresholds.ts` agrega.
 */

interface AssertContext {
  readonly vars: Readonly<Record<string, unknown>>
}

export interface AssertResult {
  readonly pass: boolean
  readonly score: number
  readonly reason: string
  readonly namedScores: Readonly<Record<string, number>>
}

/** Métricas de média (recall e MRR) passam com qualquer acerto; as demais exigem 1. */
const PARTIAL_CREDIT: ReadonlySet<MetricName> = new Set(['recall@10', 'mrr'])

export function evaluateMetric(
  metric: MetricName,
  output: string,
  context: AssertContext,
): AssertResult {
  const golden: GoldenCase = goldenCaseSchema.parse(context.vars['golden'])
  const parsed = retrievalOutputSchema.safeParse(JSON.parse(output))
  if (!parsed.success) {
    return {
      pass: false,
      score: 0,
      reason: 'saída do provider inválida',
      namedScores: { [metric]: 0 },
    }
  }
  const result = METRICS[metric](golden, parsed.data)
  if (result.score === null) {
    // Não deveria acontecer: o gerador de testes só anexa métricas aplicáveis ao caso.
    return { pass: true, score: 1, reason: `n/a: ${result.reason}`, namedScores: {} }
  }
  const pass = PARTIAL_CREDIT.has(metric) ? result.score > 0 : result.score === 1
  return {
    pass,
    score: result.score,
    reason: result.reason,
    namedScores: { [metric]: result.score },
  }
}

export function makeAssert(metric: MetricName) {
  return (output: string, context: AssertContext): AssertResult =>
    evaluateMetric(metric, output, context)
}
