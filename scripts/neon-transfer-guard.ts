/**
 * Guarda de transferência do Neon (job `neon-transfer` do `.github/workflows/ingest.yml`): lê o
 * `data_transfer_bytes` do período pela API do Neon (`GET /projects/{id}`, que não acorda o
 * compute) e para o run acima de 80% dos 5 GB do Free, antes de qualquer leitura do banco. O
 * estouro suspende o compute até o ciclo virar (incidente do staging em 2026-11-18,
 * docs/runbooks/neon-suspended.md#transferencia-acima-da-cota).
 *
 * Uso: node scripts/neon-transfer-guard.ts [--allow] [--max-ratio 0.8]
 *
 * Lê `NEON_STAGING_PROJECT_ID` e `NEON_API_KEY_STAGING`. `--allow` (input `allow_high_transfer`)
 * deixa passar com aviso: acima da guarda, e também quando a API do Neon falha. Escreve `ratio`,
 * `bytes` e `allowed` em `GITHUB_OUTPUT` e uma linha no resumo do job.
 */
import { appendFileSync } from 'node:fs'
import { exit } from 'node:process'
import { parseArgs } from 'node:util'
import { envValue, logLine } from './lib/otlp-metrics.ts'
import { fetchNeonUsage, NEON_TRANSFER_QUOTA_BYTES, neonTransferRatio } from './ops-metrics.ts'

/** Acima disto a ingestão não começa sem o input explícito. */
export const DEFAULT_MAX_TRANSFER_RATIO = 0.8

export interface GuardDeps {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly fetch: typeof fetch
  readonly log: (line: string) => void
}

export interface GuardResult {
  readonly code: number
  /** `null` quando a medida falhou. */
  readonly ratio: number | null
  readonly bytes: number | null
  readonly summary: string
}

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`
const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(2)} GB`

export async function guard(
  deps: GuardDeps,
  options: { readonly allow: boolean; readonly maxRatio: number },
): Promise<GuardResult> {
  const fail = (message: string, ratio: number | null, bytes: number | null): GuardResult => {
    if (options.allow) {
      deps.log(`::warning title=neon-transfer::${message} (liberado por allow_high_transfer)`)
      return { code: 0, ratio, bytes, summary: `${message}; liberado por \`allow_high_transfer\`` }
    }
    deps.log(
      `::error title=neon-transfer::${message}. Veja docs/runbooks/neon-suspended.md; para rodar mesmo assim, dispare com allow_high_transfer.`,
    )
    return { code: 1, ratio, bytes, summary: `${message}; run parado` }
  }

  const projectId = envValue(deps.env, 'NEON_STAGING_PROJECT_ID')
  const apiKey = envValue(deps.env, 'NEON_API_KEY_STAGING')
  if (projectId === undefined || apiKey === undefined) {
    return fail(
      `transferência do teko-staging não medida: falta ${projectId === undefined ? 'NEON_STAGING_PROJECT_ID' : 'NEON_API_KEY_STAGING'}`,
      null,
      null,
    )
  }
  let bytes: number
  try {
    bytes = (await fetchNeonUsage(projectId, apiKey, deps.fetch)).data_transfer_bytes
  } catch (error) {
    return fail(
      `transferência do teko-staging não medida: ${error instanceof Error ? error.message : String(error)}`,
      null,
      null,
    )
  }
  const ratio = neonTransferRatio(bytes)
  const used = `${gigabytes(bytes)} de ${gigabytes(NEON_TRANSFER_QUOTA_BYTES)} (${percent(ratio)})`
  if (ratio > options.maxRatio) {
    return fail(
      `teko-staging com ${used} da transferência do período, acima da guarda de ${percent(options.maxRatio)}`,
      ratio,
      bytes,
    )
  }
  return {
    code: 0,
    ratio,
    bytes,
    summary: `teko-staging com ${used} da transferência do período (guarda em ${percent(options.maxRatio)})`,
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      allow: { type: 'boolean', default: false },
      'max-ratio': { type: 'string', default: String(DEFAULT_MAX_TRANSFER_RATIO) },
    },
    strict: true,
  })
  const maxRatio = Number(values['max-ratio'])
  if (!(maxRatio > 0 && maxRatio <= 1)) {
    throw new RangeError('--max-ratio precisa estar entre 0 (exclusivo) e 1')
  }
  const result = await guard(
    { env: process.env, fetch, log: logLine },
    { allow: values.allow, maxRatio },
  )
  const outputFile = process.env['GITHUB_OUTPUT']
  if (outputFile) {
    appendFileSync(
      outputFile,
      `ratio=${result.ratio === null ? '' : result.ratio.toFixed(4)}\nbytes=${result.bytes === null ? '' : String(result.bytes)}\nallowed=${String(result.code === 0)}\n`,
    )
  }
  const summaryFile = process.env['GITHUB_STEP_SUMMARY']
  const line = `- transferência do Neon: ${result.summary}`
  if (summaryFile) {
    appendFileSync(summaryFile, `${line}\n`)
  } else {
    console.log(line)
  }
  return result.code
}

if (import.meta.main) {
  exit(await main())
}
