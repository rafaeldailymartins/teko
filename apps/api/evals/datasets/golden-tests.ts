import type { MetricName } from '../asserts/metrics.ts'
import { loadGolden } from './load-golden.ts'
import type { GoldenCase } from './schema.ts'

/**
 * Testes do promptfoo gerados a partir do golden (`tests: file://../datasets/golden-tests.ts`). Cada
 * caso recebe só os asserts que se aplicam a ele: recall@10, MRR e vigência nos `answered`; recusa
 * nos `refused`; clarificação nos ambíguos; e a data de referência quando o caso a fixa.
 */

const ASSERT_FILES: Readonly<Record<MetricName, string>> = {
  'recall@10': 'recall-at-k.ts',
  mrr: 'mrr.ts',
  vigencia: 'validity.ts',
  recusa: 'refusal.ts',
  clarificacao: 'clarification.ts',
  data_referencia: 'reference-date.ts',
}

export function metricsFor(golden: GoldenCase): MetricName[] {
  const metrics: MetricName[] = []
  if (golden.expected.status === 'answered') {
    metrics.push('recall@10', 'mrr', 'vigencia')
  } else if (golden.expected.status === 'refused') {
    metrics.push('recusa')
  } else {
    metrics.push('clarificacao')
  }
  if (golden.expected.reference_date !== undefined) {
    metrics.push('data_referencia')
  }
  return metrics
}

export function toPromptfooTest(golden: GoldenCase) {
  return {
    description: golden.id,
    vars: { question: golden.question, golden },
    assert: metricsFor(golden).map((metric) => ({
      type: 'javascript',
      value: `file://../asserts/${ASSERT_FILES[metric]}`,
      metric,
    })),
    metadata: { tags: golden.tags, pair: golden.pair ?? null },
  }
}

export default async function generateTests() {
  return loadGolden().map(toPromptfooTest)
}
