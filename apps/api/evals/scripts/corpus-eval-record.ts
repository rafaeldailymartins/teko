import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import pg from 'pg'
import { z } from 'zod'
import { type BlobStore, BlobStoreName } from '../../src/application/ports/blob-store.ts'
import { createIngestionIo } from '../../src/composition-root.ts'
import { parseEnv } from '../../src/config/env.ts'
import {
  checkSuite,
  loadThresholds,
  renderSummary,
  type ThresholdReport,
  type ThresholdsFile,
} from './check-thresholds.ts'

/**
 * Registro do `corpus-eval` (ADR 0031): junta os gates do conjunto dev e do holdout num só
 * resultado, ligado à `corpus_version` avaliada, e guarda o histórico.
 *
 *     node evals/scripts/corpus-eval-record.ts build --dev <dev.json> --holdout <holdout.json> \
 *       --out <registro.json> [--pr-body <corpo.md>] [--corpus-version <n>] [--git-sha <sha>] \
 *       [--run-url <url>]
 *     node evals/scripts/corpus-eval-record.ts history --record <registro.json> --run-id <id>
 *
 * - `build` avalia as duas suítes (`retrieval-corpus` e `retrieval-holdout`), lê a `corpus_version`
 *   do staging pela `DATABASE_URL` (quando `--corpus-version` não vem), grava o registro (que o
 *   `lock-pr` commita como `corpus/corpus.eval.json` ao lado do lock) e o corpo do PR do lock, e sai
 *   com 1 se algum gate reprovar. Escreve `corpus_version` e `pass` no `$GITHUB_OUTPUT`.
 * - `history` grava o registro no store `eval-artifacts` (porta `BlobStore`) em
 *   `history/corpus-v<NNNNNN>/<run_id>.json` e compara com o registro anterior no resumo.
 */

const SUITES = { dev: 'retrieval-corpus', holdout: 'retrieval-holdout' } as const
type SuiteName = keyof typeof SUITES

export const EVAL_RECORD_FORMAT = 1
export const HISTORY_PREFIX = 'history/'

const intervalSchema = z.strictObject({ low: z.number(), high: z.number() })

const metricRecordSchema = z.strictObject({
  mean: z.number(),
  ci: intervalSchema,
  cases: z.int().nonnegative(),
  threshold: z.number().nullable(),
  target: z.number().nullable(),
  pass: z.boolean(),
})

const suiteRecordSchema = z.strictObject({
  thresholds: z.string().min(1),
  pass: z.boolean(),
  errors: z.int().nonnegative(),
  metrics: z.record(z.string(), metricRecordSchema),
})

export const evalRecordSchema = z.strictObject({
  format: z.literal(EVAL_RECORD_FORMAT),
  corpusVersion: z.int().positive(),
  evaluatedAt: z.iso.datetime({ offset: true }),
  gitSha: z.string().nullable(),
  runUrl: z.string().nullable(),
  /** Provedores da busca avaliada (linhagem do resultado). */
  retrieval: z.strictObject({ embeddings: z.string(), reranker: z.string() }),
  pass: z.boolean(),
  suites: z.strictObject({ dev: suiteRecordSchema, holdout: suiteRecordSchema }),
})
export type EvalRecord = z.output<typeof evalRecordSchema>

function suiteRecord(thresholds: string, report: ThresholdReport) {
  return {
    thresholds,
    pass: report.pass,
    errors: report.errors.length,
    metrics: Object.fromEntries(
      report.metrics.map((m) => [
        m.metric,
        {
          mean: m.mean,
          ci: m.ci,
          cases: m.cases,
          threshold: m.threshold,
          target: m.target,
          pass: m.pass,
        },
      ]),
    ),
  }
}

export interface BuildInput {
  readonly reports: Readonly<Record<SuiteName, ThresholdReport>>
  readonly corpusVersion: number
  readonly gitSha: string | null
  readonly runUrl: string | null
  readonly retrieval: { readonly embeddings: string; readonly reranker: string }
  readonly now: Date
}

export function buildRecord(input: BuildInput): EvalRecord {
  const { reports } = input
  return evalRecordSchema.parse({
    format: EVAL_RECORD_FORMAT,
    corpusVersion: input.corpusVersion,
    evaluatedAt: input.now.toISOString(),
    gitSha: input.gitSha,
    runUrl: input.runUrl,
    retrieval: input.retrieval,
    pass: reports.dev.pass && reports.holdout.pass,
    suites: {
      dev: suiteRecord(SUITES.dev, reports.dev),
      holdout: suiteRecord(SUITES.holdout, reports.holdout),
    },
  })
}

const SUITE_TITLES: Readonly<Record<SuiteName, string>> = {
  dev: 'Conjunto dev (onde se ajusta)',
  holdout: 'Conjunto holdout (nunca orienta parâmetros)',
}

/**
 * Resumo do corpus-eval: a `corpus_version` avaliada e, por conjunto, a tabela com os casos abaixo
 * de 1 e os erros do provider (o mesmo resumo do `check-thresholds`).
 */
export function renderEvalSummary(
  record: EvalRecord,
  reports: Readonly<Record<SuiteName, ThresholdReport>>,
): string {
  const header = `## corpus-eval (corpus_version ${String(record.corpusVersion)}): ${record.pass ? 'aprovado' : 'REPROVADO'}\n\n`
  return (
    header +
    (['dev', 'holdout'] as const)
      .map((suite) => renderSummary(SUITE_TITLES[suite], reports[suite]))
      .join('\n')
  )
}

const fmt = (value: number) => value.toFixed(3)

/** Corpo do PR do lock: métricas de dev e holdout e a `corpus_version`. */
export function renderPrBody(record: EvalRecord): string {
  const rows = (suite: SuiteName) =>
    Object.entries(record.suites[suite].metrics).map(
      ([metric, m]) =>
        `| ${suite} | ${metric} | ${fmt(m.mean)} | ${fmt(m.ci.low)}–${fmt(m.ci.high)} | ${m.threshold === null ? '—' : m.threshold.toFixed(2)} | ${String(m.cases)} |`,
    )
  return [
    `### corpus-eval da corpus_version ${String(record.corpusVersion)}: ${record.pass ? 'aprovado' : 'REPROVADO'}`,
    '',
    '| Conjunto | Métrica | Média | IC 95% | Gate | Casos |',
    '|---|---|---|---|---|---|',
    ...rows('dev'),
    ...rows('holdout'),
    '',
    `Busca avaliada: embeddings \`${record.retrieval.embeddings}\`, reranker \`${record.retrieval.reranker}\`${record.gitSha === null ? '' : `, código em \`${record.gitSha.slice(0, 12)}\``}.`,
    '',
  ].join('\n')
}

export function historyKey(corpusVersion: number, runId: string): string {
  return `${HISTORY_PREFIX}corpus-v${String(corpusVersion).padStart(6, '0')}/${runId}.json`
}

/**
 * Grava o registro no histórico e devolve o registro anterior mais recente (de outra chave), para
 * a comparação no resumo. As chaves ordenam pela `corpus_version` (com zeros à esquerda) e, dentro
 * dela, pelo `run_id`, que cresce.
 */
export async function recordHistory(
  blobs: BlobStore,
  record: EvalRecord,
  runId: string,
): Promise<EvalRecord | null> {
  const key = historyKey(record.corpusVersion, runId)
  const keys = (await blobs.list(BlobStoreName.EvalArtifacts, HISTORY_PREFIX)).filter(
    (candidate) => candidate !== key && candidate < key,
  )
  let previous: EvalRecord | null = null
  for (const candidate of keys.reverse()) {
    const bytes = await blobs.get(BlobStoreName.EvalArtifacts, candidate)
    const parsed =
      bytes === null
        ? null
        : evalRecordSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)))
    if (parsed?.success === true) {
      previous = parsed.data
      break
    }
  }
  await blobs.set(BlobStoreName.EvalArtifacts, key, `${JSON.stringify(record, null, 2)}\n`)
  return previous
}

/** Tabela "anterior → atual" das métricas de cada conjunto. */
export function renderComparison(previous: EvalRecord | null, current: EvalRecord): string {
  if (previous === null) {
    return `Histórico: primeiro registro (corpus_version ${String(current.corpusVersion)}).\n`
  }
  const lines = [
    `#### Histórico: corpus_version ${String(previous.corpusVersion)} → ${String(current.corpusVersion)}`,
    '',
    '| Conjunto | Métrica | Anterior | Atual | Δ |',
    '|---|---|---|---|---|',
  ]
  for (const suite of ['dev', 'holdout'] as const) {
    for (const [metric, m] of Object.entries(current.suites[suite].metrics)) {
      const before = previous.suites[suite].metrics[metric]?.mean
      const delta =
        before === undefined ? '—' : `${m.mean - before >= 0 ? '+' : ''}${fmt(m.mean - before)}`
      lines.push(
        `| ${suite} | ${metric} | ${before === undefined ? '—' : fmt(before)} | ${fmt(m.mean)} | ${delta} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

async function stagingCorpusVersion(url: string): Promise<number> {
  const client = new pg.Client({ connectionString: url, application_name: 'teko-corpus-eval' })
  await client.connect()
  try {
    const { rows } = await client.query<{ id: number | null }>(
      'SELECT max(id)::int AS id FROM corpus.corpus_versions',
    )
    const id = rows[0]?.id
    if (id === null || id === undefined) {
      throw new Error('o staging não tem corpus_version (corpus.corpus_versions vazia)')
    }
    return id
  } finally {
    await client.end()
  }
}

function writeOutputs(values: Readonly<Record<string, string>>): void {
  const file = process.env['GITHUB_OUTPUT']
  if (file) {
    appendFileSync(
      file,
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
    )
  }
}

function writeSummary(text: string): void {
  console.log(text)
  const file = process.env['GITHUB_STEP_SUMMARY']
  if (file) {
    appendFileSync(file, text)
  }
}

function evalEnv() {
  return parseEnv({ APP_ENV: 'ci', WEB_ORIGIN: 'http://localhost:3000', ...process.env })
}

const USAGE = [
  'uso: corpus-eval-record.ts build --dev <json> --holdout <json> --out <json> [--pr-body <md>]',
  '       [--corpus-version <n>] [--git-sha <sha>] [--run-url <url>]',
  '     corpus-eval-record.ts history --record <json> --run-id <id>',
].join('\n')

async function runBuild(args: readonly string[], file: ThresholdsFile): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      dev: { type: 'string' },
      holdout: { type: 'string' },
      out: { type: 'string' },
      'pr-body': { type: 'string' },
      'corpus-version': { type: 'string' },
      'git-sha': { type: 'string' },
      'run-url': { type: 'string' },
    },
    strict: true,
  })
  if (values.dev === undefined || values.holdout === undefined || values.out === undefined) {
    console.error(USAGE)
    return 64
  }
  const reports = {
    dev: checkSuite(values.dev, SUITES.dev, file),
    holdout: checkSuite(values.holdout, SUITES.holdout, file),
  }
  const env = evalEnv()
  let corpusVersion = Number(values['corpus-version'] ?? Number.NaN)
  if (!Number.isInteger(corpusVersion)) {
    if (env.DATABASE_URL === undefined) {
      console.error('informe --corpus-version ou DATABASE_URL (banco avaliado)')
      return 64
    }
    corpusVersion = await stagingCorpusVersion(env.DATABASE_URL)
  }
  const record = buildRecord({
    reports,
    corpusVersion,
    gitSha: values['git-sha'] ?? null,
    runUrl: values['run-url'] ?? null,
    retrieval: {
      embeddings: env.EMBEDDINGS_PROVIDER ?? 'nenhum',
      reranker: env.RERANKER_PROVIDER,
    },
    now: new Date(),
  })
  writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`)
  if (values['pr-body'] !== undefined) {
    writeFileSync(values['pr-body'], renderPrBody(record))
  }
  writeSummary(renderEvalSummary(record, reports))
  writeOutputs({ corpus_version: String(corpusVersion), pass: String(record.pass) })
  return record.pass ? 0 : 1
}

async function runHistory(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { record: { type: 'string' }, 'run-id': { type: 'string' } },
    strict: true,
  })
  if (values.record === undefined || values['run-id'] === undefined) {
    console.error(USAGE)
    return 64
  }
  const record = evalRecordSchema.parse(JSON.parse(readFileSync(values.record, 'utf8')))
  const { blobs } = createIngestionIo(evalEnv(), [])
  const previous = await recordHistory(blobs, record, values['run-id'])
  writeSummary(renderComparison(previous, record))
  return 0
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv
  if (command === 'build') {
    return runBuild(rest, loadThresholds())
  }
  if (command === 'history') {
    return runHistory(rest)
  }
  console.error(USAGE)
  return 64
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2))
}
