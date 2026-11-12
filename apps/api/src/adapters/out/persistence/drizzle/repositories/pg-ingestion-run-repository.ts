import { eq, sql } from 'drizzle-orm'
import {
  type IngestionRunRepository,
  IngestionRunStatus,
  IngestionTarget,
} from '#app/ports/ingestion-run-repository.ts'
import type { DrizzleDb } from '../client.ts'
import { ingestionRuns } from '../schema/corpus.ts'

/**
 * `corpus.ingestion_runs` sobre o Drizzle (owner). `addNeurons` é um `UPDATE` atômico com commit
 * próprio (checkpoint do orçamento); `neuronsSpentOn` soma os runs iniciados no dia do fuso pedido.
 * No fechamento, `docs` é contado no banco (versões publicadas pelo run) e `chunks_new` vem de
 * `report.chunksNew` (a soma que o CLI faz dos resultados do `IngestDocumentVersion`).
 */

type ReportObject = Record<string, unknown>

function asReport(value: unknown): ReportObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function asTarget(value: string): IngestionTarget {
  const found = Object.values(IngestionTarget).find((target) => target === value)
  if (found === undefined) {
    throw new RangeError(`target de ingestão desconhecido: ${value}`)
  }
  return found
}

function asStatus(value: string): IngestionRunStatus {
  const found = Object.values(IngestionRunStatus).find((status) => status === value)
  if (found === undefined) {
    throw new RangeError(`status de ingestão desconhecido: ${value}`)
  }
  return found
}

export function createPgIngestionRunRepository(db: DrizzleDb): IngestionRunRepository {
  return {
    async start({ target, gitSha, report, startedAt }) {
      const [row] = await db
        .insert(ingestionRuns)
        .values({ target, gitSha, status: IngestionRunStatus.Running, report, startedAt })
        .returning({ id: ingestionRuns.id })
      if (row === undefined) {
        throw new Error('não foi possível abrir o run de ingestão')
      }
      return row.id
    },
    async get(runId) {
      const [row] = await db.select().from(ingestionRuns).where(eq(ingestionRuns.id, runId))
      if (row === undefined) {
        return null
      }
      return {
        id: row.id,
        target: asTarget(row.target),
        status: asStatus(row.status),
        neurons: row.neurons,
        report: asReport(row.report),
      }
    },
    async addNeurons(runId, neurons) {
      await db
        .update(ingestionRuns)
        .set({ neurons: sql`${ingestionRuns.neurons} + ${Math.ceil(neurons)}` })
        .where(eq(ingestionRuns.id, runId))
    },
    async neuronsSpentOn(day, timeZone) {
      const result = await db.execute<{ total: number }>(sql`
        SELECT coalesce(sum(neurons), 0)::int AS total FROM corpus.ingestion_runs
        WHERE (started_at AT TIME ZONE ${timeZone})::date = ${day}::date`)
      return result.rows[0]?.total ?? 0
    },
    async finish({ runId, status, report, cuSeconds, dbBytes }) {
      const [current] = await db
        .select({ report: ingestionRuns.report })
        .from(ingestionRuns)
        .where(eq(ingestionRuns.id, runId))
      const merged = { ...asReport(current?.report), ...report }
      const chunksNew = typeof merged['chunksNew'] === 'number' ? merged['chunksNew'] : 0
      await db
        .update(ingestionRuns)
        .set({
          status,
          report: merged,
          cuSeconds: cuSeconds === null ? null : cuSeconds.toFixed(3),
          dbBytes,
          chunksNew: Math.trunc(chunksNew),
          docs: sql`(SELECT count(*)::int FROM corpus.document_versions dv
            WHERE dv.ingestion_run_id = ${runId} AND dv.status = 'published')`,
          finishedAt: sql`now()`,
        })
        .where(eq(ingestionRuns.id, runId))
    },
  }
}
