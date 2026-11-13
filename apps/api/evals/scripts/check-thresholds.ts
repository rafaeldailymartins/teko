import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/**
 * Gate das evals: lê o JSON do `promptfoo eval -o <arquivo>`, calcula a média de cada métrica
 * (componentes com `assertion.metric`), com o intervalo de confiança de 95%, e compara com a seção
 * da suíte em `thresholds.json`. Escreve o resumo no `$GITHUB_STEP_SUMMARY` (quando existe) e sai
 * com 1 se alguma métrica ficar abaixo do gate, se faltar alguma métrica ou se algum caso terminar
 * em erro do provider.
 *
 *     node evals/scripts/check-thresholds.ts reports/retrieval-evals.json [retrieval]
 *
 * Suítes (ADR 0031): `retrieval` (fixture do PR, conjunto dev), `retrieval-corpus` (corpus-eval,
 * dev) e `retrieval-holdout` (corpus-eval, holdout). Um limite `null` deixa a métrica só
 * informativa (sai no resumo, não reprova); `metas` traz as metas de fase, mostradas ao lado do
 * gate sem reprovar.
 *
 * Intervalo de confiança: Wilson para as métricas de proporção (recall@10, vigência, recusa,
 * clarificação, data de referência, sem resposta; no recall com vários dispositivos esperados, a
 * média das frações entra como proporção) e média ± 1,96 erro-padrão para o MRR, que não é
 * proporção. Com 50 casos, o intervalo de um MRR de 0,68 tem cerca de ±0,11: diferenças menores
 * que isso entre dois runs não são sinal.
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

/** z para 95% (bicaudal). */
const Z_95 = 1.959964

/** Limites de uma suíte: número = gate; `null` = só informativa. */
const suiteThresholdsSchema = z.record(z.string(), z.number().min(0).max(1).nullable())
export type SuiteThresholds = z.output<typeof suiteThresholdsSchema>

const thresholdsFileSchema = z.object({
  /** Metas de fase por suíte (ex.: MRR 0,70 da F4 no holdout); não reprovam. */
  metas: z.record(z.string(), z.record(z.string(), z.number().min(0).max(1))).default({}),
})

export interface ThresholdsFile {
  readonly suites: Readonly<Record<string, SuiteThresholds>>
  readonly metas: Readonly<Record<string, Readonly<Record<string, number>>>>
}

/** Lê `thresholds.json`: chaves com `$` são comentários; `metas` é a seção das metas. */
export function parseThresholds(raw: unknown): ThresholdsFile {
  const entries = Object.entries(z.record(z.string(), z.unknown()).parse(raw)).filter(
    ([key]) => !key.startsWith('$'),
  )
  const { metas } = thresholdsFileSchema.parse(Object.fromEntries(entries))
  const suites = Object.fromEntries(
    entries
      .filter(([key]) => key !== 'metas')
      .map(([key, value]) => [key, suiteThresholdsSchema.parse(value)]),
  )
  return { suites, metas }
}

export function loadThresholds(): ThresholdsFile {
  const file = fileURLToPath(new URL('../thresholds.json', import.meta.url))
  return parseThresholds(JSON.parse(readFileSync(file, 'utf8')))
}

export interface Interval {
  readonly low: number
  readonly high: number
}

/** Intervalo de Wilson (95%) para uma proporção `p` observada em `n` casos. */
export function wilsonInterval(p: number, n: number): Interval {
  if (n === 0) {
    return { low: 0, high: 1 }
  }
  const z2 = Z_95 * Z_95
  const center = (p + z2 / (2 * n)) / (1 + z2 / n)
  const half = (Z_95 / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

/** Média ± 1,96 erro-padrão (desvio amostral), limitada a [0, 1]. */
export function meanInterval(scores: readonly number[]): Interval {
  const n = scores.length
  if (n === 0) {
    return { low: 0, high: 1 }
  }
  const mean = scores.reduce((sum, score) => sum + score, 0) / n
  if (n === 1) {
    return { low: mean, high: mean }
  }
  const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / (n - 1)
  const half = Z_95 * Math.sqrt(variance / n)
  return { low: Math.max(0, mean - half), high: Math.min(1, mean + half) }
}

/** Métricas que não são proporção: intervalo pelo erro-padrão da média. */
const MEAN_METRICS: ReadonlySet<string> = new Set(['mrr'])

export interface MetricSummary {
  readonly metric: string
  readonly mean: number
  readonly cases: number
  /** Intervalo de confiança de 95% da média. */
  readonly ci: Interval
  /** Gate; `null` = métrica só informativa. */
  readonly threshold: number | null
  /** Meta de fase (não reprova); `null` quando não há. */
  readonly target: number | null
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
  thresholds: Readonly<Record<string, number | null>>,
  targets: Readonly<Record<string, number>> = {},
): ThresholdReport {
  const { results } = outputSchema.parse(output).results
  const scores = new Map<string, { values: number[]; failures: string[] }>()
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
      const entry = scores.get(metric) ?? { values: [], failures: [] }
      entry.values.push(component.score)
      if (component.score < 1) {
        entry.failures.push(`${name}: ${component.reason ?? `score ${String(component.score)}`}`)
      }
      scores.set(metric, entry)
    }
  }
  const metrics = Object.entries(thresholds).map(([metric, threshold]): MetricSummary => {
    const values = scores.get(metric)?.values ?? []
    const cases = values.length
    const mean = cases === 0 ? 0 : values.reduce((sum, score) => sum + score, 0) / cases
    return {
      metric,
      mean,
      cases,
      ci: MEAN_METRICS.has(metric) ? meanInterval(values) : wilsonInterval(mean, cases),
      threshold,
      target: targets[metric] ?? null,
      // Métrica sem nenhum caso reprova, mesmo informativa: o dataset não pode ficar vazio.
      pass: cases > 0 && (threshold === null || mean >= threshold - 1e-9),
      failures: scores.get(metric)?.failures ?? [],
    }
  })
  return { metrics, errors, pass: errors.length === 0 && metrics.every((metric) => metric.pass) }
}

const fmt = (value: number) => value.toFixed(3)
const fmtLimit = (value: number | null) => (value === null ? '—' : value.toFixed(2))

function statusOf(metric: MetricSummary): string {
  if (!metric.pass) {
    return 'falhou'
  }
  if (metric.threshold === null) {
    return 'informativa'
  }
  return 'ok'
}

/** Tabela das métricas (sem título), reaproveitada pelo registro do corpus-eval. */
export function renderMetricsTable(report: ThresholdReport): string[] {
  return [
    '| Métrica | Média | IC 95% | Gate | Meta | Casos | |',
    '|---|---|---|---|---|---|---|',
    ...report.metrics.map(
      (m) =>
        `| ${m.metric} | ${fmt(m.mean)} | ${fmt(m.ci.low)}–${fmt(m.ci.high)} | ${fmtLimit(m.threshold)} | ${fmtLimit(m.target)} | ${String(m.cases)} | ${statusOf(m)} |`,
    ),
  ]
}

export function renderSummary(title: string, report: ThresholdReport): string {
  const lines = [`### ${title}: ${report.pass ? 'aprovado' : 'REPROVADO'}`, '']
  lines.push(...renderMetricsTable(report))
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

/** Avalia o arquivo de saída do promptfoo contra uma suíte de `thresholds.json`. */
export function checkSuite(
  outputPath: string,
  suite: string,
  file: ThresholdsFile,
): ThresholdReport {
  const thresholds = file.suites[suite]
  if (thresholds === undefined) {
    throw new Error(`suite desconhecida em thresholds.json: ${suite}`)
  }
  return evaluateThresholds(
    JSON.parse(readFileSync(outputPath, 'utf8')),
    thresholds,
    file.metas[suite] ?? {},
  )
}

function main(argv: readonly string[]): number {
  const [outputPath, suite = 'retrieval'] = argv
  if (outputPath === undefined) {
    console.error('uso: check-thresholds.ts <saida-do-promptfoo.json> [suite]')
    return 64
  }
  const file = loadThresholds()
  if (file.suites[suite] === undefined) {
    console.error(`suite desconhecida em thresholds.json: ${suite}`)
    return 64
  }
  const report = checkSuite(outputPath, suite, file)
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
