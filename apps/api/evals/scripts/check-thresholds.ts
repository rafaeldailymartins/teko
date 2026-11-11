import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Gate das evals: lê o JSON do `promptfoo eval -o <arquivo>`, calcula a média de cada métrica
 * (componentes com `assertion.metric`) e compara com `thresholds.json`. Escreve o resumo no
 * `$GITHUB_STEP_SUMMARY` (quando existe) e sai com 1 se alguma métrica ficar abaixo do gate, se
 * faltar alguma métrica ou se algum caso terminar em erro do provider.
 *
 *     node evals/scripts/check-thresholds.ts reports/retrieval-evals.json [retrieval]
 */

const componentSchema = z.object({
  score: z.number(),
  reason: z.string().optional(),
  assertion: z.object({ metric: z.string().optional() }).nullish(),
})

const resultSchema = z.object({
  description: z.string().optional(),
  testCase: z.object({ description: z.string().optional() }).optional(),
  error: z.string().nullish(),
  /** `ResultFailureReason` do promptfoo: 0 nenhuma, 1 assert, 2 erro do provider. */
  failureReason: z.number().optional(),
  gradingResult: z.object({ componentResults: z.array(componentSchema).nullish() }).nullish(),
})

const outputSchema = z.object({
  results: z.object({ results: z.array(resultSchema) }),
})

const PROVIDER_ERROR = 2

const thresholdsSchema = z.record(z.string(), z.record(z.string(), z.number()))

export interface MetricSummary {
  readonly metric: string
  readonly mean: number
  readonly cases: number
  readonly threshold: number
  readonly pass: boolean
  readonly failures: readonly string[]
}

export interface ThresholdReport {
  readonly metrics: readonly MetricSummary[]
  readonly errors: readonly string[]
  readonly pass: boolean
}

export function evaluateThresholds(
  output: unknown,
  thresholds: Readonly<Record<string, number>>,
): ThresholdReport {
  const { results } = outputSchema.parse(output).results
  const scores = new Map<string, { sum: number; count: number; failures: string[] }>()
  const errors: string[] = []
  for (const result of results) {
    const name = result.testCase?.description ?? result.description ?? '(sem descrição)'
    if (result.failureReason === PROVIDER_ERROR) {
      errors.push(`${name}: ${result.error}`)
    }
    for (const component of result.gradingResult?.componentResults ?? []) {
      const metric = component.assertion?.metric
      if (metric === undefined) {
        continue
      }
      const entry = scores.get(metric) ?? { sum: 0, count: 0, failures: [] }
      entry.sum += component.score
      entry.count += 1
      if (component.score < 1) {
        entry.failures.push(`${name}: ${component.reason ?? `score ${String(component.score)}`}`)
      }
      scores.set(metric, entry)
    }
  }
  const metrics = Object.entries(thresholds).map(([metric, threshold]): MetricSummary => {
    const entry = scores.get(metric)
    const mean = entry === undefined || entry.count === 0 ? 0 : entry.sum / entry.count
    return {
      metric,
      mean,
      cases: entry?.count ?? 0,
      threshold,
      // Métrica sem nenhum caso reprova: o gate não pode passar porque o dataset ficou vazio.
      pass: entry !== undefined && entry.count > 0 && mean >= threshold - 1e-9,
      failures: entry?.failures ?? [],
    }
  })
  return { metrics, errors, pass: errors.length === 0 && metrics.every((metric) => metric.pass) }
}

export function renderSummary(title: string, report: ThresholdReport): string {
  const lines = [
    `### ${title}: ${report.pass ? 'aprovado' : 'REPROVADO'}`,
    '',
    '| Métrica | Média | Gate | Casos | |',
    '|---|---|---|---|---|',
    ...report.metrics.map(
      (m) =>
        `| ${m.metric} | ${m.mean.toFixed(3)} | ${m.threshold.toFixed(2)} | ${String(m.cases)} | ${m.pass ? 'ok' : 'falhou'} |`,
    ),
  ]
  const failures = report.metrics.flatMap((m) => m.failures.map((f) => `- \`${m.metric}\` ${f}`))
  if (failures.length > 0) {
    lines.push(
      '',
      '<details><summary>Casos abaixo de 1</summary>',
      '',
      ...failures,
      '',
      '</details>',
    )
  }
  if (report.errors.length > 0) {
    lines.push('', '**Erros do provider:**', ...report.errors.map((e) => `- ${e}`))
  }
  return `${lines.join('\n')}\n`
}

function main(argv: readonly string[]): number {
  const [outputPath, suite = 'retrieval'] = argv
  if (outputPath === undefined) {
    console.error('uso: check-thresholds.ts <saida-do-promptfoo.json> [suite]')
    return 64
  }
  const thresholdsFile = fileURLToPath(new URL('../thresholds.json', import.meta.url))
  const thresholds = thresholdsSchema.parse(
    Object.fromEntries(
      Object.entries(
        JSON.parse(readFileSync(thresholdsFile, 'utf8')) as Record<string, unknown>,
      ).filter(([key]) => !key.startsWith('$')),
    ),
  )[suite]
  if (thresholds === undefined) {
    console.error(`suite desconhecida em thresholds.json: ${suite}`)
    return 64
  }
  const report = evaluateThresholds(JSON.parse(readFileSync(outputPath, 'utf8')), thresholds)
  const summary = renderSummary(`Evals (${suite})`, report)
  console.log(summary)
  const stepSummary = process.env['GITHUB_STEP_SUMMARY']
  if (stepSummary) {
    appendFileSync(stepSummary, summary)
  }
  return report.pass ? 0 : 1
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
