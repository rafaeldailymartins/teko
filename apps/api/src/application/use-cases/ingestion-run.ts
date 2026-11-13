import type { Clock } from '../ports/clock.ts'
import type {
  ComputeUsageMeter,
  DatabaseUsage,
  VectorIndexMaintenance,
} from '../ports/database-usage.ts'
import {
  type FinishedRunStatus,
  type IngestionRunRepository,
  IngestionTarget,
} from '../ports/ingestion-run-repository.ts'

/**
 * Abertura e fechamento de um run de ingestão (`corpus.ingestion_runs`).
 *
 * - `--bulk` (só staging): o HNSW de `corpus.chunks` sai antes da carga e volta no fechamento, com
 *   `maintenance_work_mem='256MB'` (construir o índice uma vez é muito mais barato que mantê-lo a
 *   cada lote). O fechamento sempre garante o índice, e um run sem `--bulk` o garante já na
 *   abertura (um `--bulk` anterior que caiu no meio deixa o staging sem HNSW). O índice é parcial
 *   (`WHERE upper_inf(knowledge)`), como no schema.
 * - CU-h: os CU-segundos do projeto Neon são lidos no início e no fim (API v2); a diferença vai a
 *   `cu_seconds`. Sem credenciais (ou com a API fora), fica `null`.
 * - `db_bytes`: `pg_database_size` no fechamento.
 */

interface StartIngestionRunCommand {
  readonly target: IngestionTarget
  readonly gitSha: string
  readonly bulk?: boolean
}

interface FinishIngestionRunCommand {
  readonly runId: string
  readonly status: FinishedRunStatus
  readonly report: Readonly<Record<string, unknown>>
}

export type StartIngestionRun = (
  command: StartIngestionRunCommand,
) => Promise<{ readonly runId: string }>
/** O que o fechamento mediu: tamanho do banco e CU-segundos do run (null sem a API do Neon). */
interface FinishedRunUsage {
  readonly dbBytes: number
  readonly cuSeconds: number | null
}

export type FinishIngestionRun = (command: FinishIngestionRunCommand) => Promise<FinishedRunUsage>

export interface IngestionRunDeps {
  readonly runs: IngestionRunRepository
  readonly databaseUsage: DatabaseUsage
  readonly vectorIndex: VectorIndexMaintenance
  readonly compute: ComputeUsageMeter
  readonly clock: Clock
}

export class BulkLoadNotAllowedError extends Error {
  constructor(target: string) {
    super(`--bulk só é permitido com --target staging (recebido: ${target})`)
    this.name = 'BulkLoadNotAllowedError'
  }
}

export class IngestionRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run de ingestão ${runId} não encontrado`)
    this.name = 'IngestionRunNotFoundError'
  }
}

const COMPUTE_AT_START = 'computeSecondsAtStart'

async function safeComputeSeconds(compute: ComputeUsageMeter): Promise<number | null> {
  try {
    return await compute.computeSeconds()
  } catch {
    // A medição é informativa: a API do Neon fora do ar não derruba a ingestão.
    return null
  }
}

export function createStartIngestionRun(deps: IngestionRunDeps): StartIngestionRun {
  return async ({ target, gitSha, bulk = false }) => {
    if (bulk && target !== IngestionTarget.Staging) {
      throw new BulkLoadNotAllowedError(target)
    }
    const computeAtStart = await safeComputeSeconds(deps.compute)
    const runId = await deps.runs.start({
      target,
      gitSha,
      report: { bulk, [COMPUTE_AT_START]: computeAtStart },
      startedAt: deps.clock.now(),
    })
    // B6: um `--bulk` que caiu no meio deixa o staging sem HNSW (a busca degrada para varredura);
    // o run seguinte sem `--bulk` o recria logo no início, sem esperar o fechamento.
    await (bulk ? deps.vectorIndex.dropVectorIndex() : deps.vectorIndex.ensureVectorIndex())
    return { runId }
  }
}

export function createFinishIngestionRun(deps: IngestionRunDeps): FinishIngestionRun {
  return async ({ runId, status, report }) => {
    const run = await deps.runs.get(runId)
    if (run === null) {
      throw new IngestionRunNotFoundError(runId)
    }
    await deps.vectorIndex.ensureVectorIndex()
    const started = run.report[COMPUTE_AT_START]
    const finished = await safeComputeSeconds(deps.compute)
    const cuSeconds =
      typeof started === 'number' && finished !== null ? Math.max(0, finished - started) : null
    const dbBytes = await deps.databaseUsage.sizeBytes()
    await deps.runs.finish({ runId, status, report, cuSeconds, dbBytes })
    return { dbBytes, cuSeconds }
  }
}
