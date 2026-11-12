import { and, eq, lt, notInArray, sql } from 'drizzle-orm'
import type {
  CoverageWatchRepository,
  FamilyGap,
  MarkVerifiedCommand,
} from '#app/ports/watch-coverage-repository.ts'
import type { DrizzleDb } from '../client.ts'
import { coverage } from '../schema/corpus.ts'

/**
 * `corpus.coverage` pelo role `teko_watch` (`NEON_PROD_WATCH_URL`, `NEON_STAGING_WATCH_URL`), que
 * só tem `SELECT` na tabela e `UPDATE (verified_at, gaps, gap_reason)`.
 *
 * - Sem lacunas e sem exclusões: um único `UPDATE ... SET verified_at = $1 WHERE verified_at < $1`,
 *   sem transação explícita (acorda o Neon uma vez por dia e nada mais).
 * - Com lacunas: numa transação, `gaps = gaps + datemultirange(daterange(from, NULL))` e
 *   `gap_reason` por família, e depois o mesmo avanço de `verified_at`.
 * - Famílias excluídas (verificação falhou no run) ficam fora do avanço de `verified_at`.
 */

type Executor = Pick<DrizzleDb, 'update'>

function rowCount(result: { rowCount?: number | null }): number {
  return result.rowCount ?? 0
}

async function advanceVerifiedAt(
  executor: Executor,
  command: Pick<MarkVerifiedCommand, 'verifiedAt' | 'excludeFamilies'>,
): Promise<number> {
  const older = lt(coverage.verifiedAt, command.verifiedAt)
  const where =
    command.excludeFamilies.length === 0
      ? older
      : and(older, notInArray(coverage.family, [...command.excludeFamilies]))
  const result = await executor
    .update(coverage)
    .set({ verifiedAt: command.verifiedAt })
    .where(where)
  return rowCount(result)
}

async function addGap(executor: Executor, gap: FamilyGap): Promise<number> {
  const result = await executor
    .update(coverage)
    .set({
      gaps: sql`${coverage.gaps} + datemultirange(daterange(${gap.from}::date, NULL))`,
      gapReason: gap.reason,
    })
    .where(eq(coverage.family, gap.family))
  return rowCount(result)
}

export function createPgCoverageWatchRepository(db: DrizzleDb): CoverageWatchRepository {
  return {
    async markVerified(command) {
      if (command.gaps.length === 0) {
        return { verifiedRows: await advanceVerifiedAt(db, command), gapRows: 0 }
      }
      return db.transaction(async (tx) => {
        let gapRows = 0
        for (const gap of command.gaps) {
          gapRows += await addGap(tx, gap)
        }
        return { verifiedRows: await advanceVerifiedAt(tx, command), gapRows }
      })
    },
  }
}
