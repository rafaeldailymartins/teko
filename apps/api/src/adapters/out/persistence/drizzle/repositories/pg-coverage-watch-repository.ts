import { and, eq, lt, notInArray, sql } from 'drizzle-orm'
import type {
  CoverageWatchRepository,
  FamilyGap,
  MarkVerifiedCommand,
} from '#app/ports/watch-coverage-repository.ts'
import { addGapEntry } from '#domain/corpus/coverage-gaps.ts'
import type { DrizzleDb } from '../client.ts'
import { coverage } from '../schema/corpus.ts'
import { gapColumns, storedGapEntries } from './coverage-gap-entries.ts'

/**
 * `corpus.coverage` pelo role `teko_watch` (`NEON_PROD_WATCH_URL`, `NEON_STAGING_WATCH_URL`), que
 * só tem `SELECT` na tabela e `UPDATE (verified_at, gaps, gap_reason, gap_entries)`.
 *
 * - Sem lacunas e sem exclusões: um único `UPDATE ... SET verified_at = $1 WHERE verified_at < $1`,
 *   sem transação explícita (acorda o Neon uma vez por dia e nada mais).
 * - Com lacunas: numa transação, cada família é lida com `FOR UPDATE`, a entrada da lacuna entra
 *   em `gap_entries` (`addGapEntry`: documentos que a resolvem, `[from, ∞)` e o instante da
 *   detecção) e `gaps`/`gap_reason` são regravados como a soma das entradas; depois, o mesmo
 *   avanço de `verified_at`.
 * - Famílias excluídas (verificação falhou no run) ficam fora do avanço de `verified_at`.
 */

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]
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

/**
 * Banco ainda sem a migração `coverage-gap-entries` (o staging a recebe no `ingest load
 * --migrate`, a produção no deploy): sem lacuna, o avanço do `verified_at` funciona igual; com
 * lacuna, a marcação falha com esta mensagem, e nada da transação é gravado.
 */
export class GapEntriesMigrationPendingError extends Error {
  constructor(cause: unknown) {
    super(
      'corpus.coverage sem a coluna gap_entries: a migração coverage-gap-entries ainda não rodou ' +
        'neste banco (staging: rode o ingest, que aplica --migrate; produção: o deploy)',
      { cause },
    )
    this.name = 'GapEntriesMigrationPendingError'
  }
}

function missingGapEntries(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== undefined && depth < 5; depth += 1) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      current.code === '42703' &&
      current instanceof Error &&
      current.message.includes('gap_entries')
    ) {
      return true
    }
    current = current instanceof Error ? current.cause : undefined
  }
  return false
}

/** Acrescenta as lacunas de uma família; devolve 1 se a família tem linha de cobertura. */
async function addGaps(tx: Tx, family: string, gaps: readonly FamilyGap[]): Promise<number> {
  const current = await tx
    .execute<{
      gaps: string
      gap_reason: string | null
      gap_entries: unknown
    }>(
      sql`SELECT gaps::text AS gaps, gap_reason, gap_entries FROM corpus.coverage
        WHERE family = ${family} FOR UPDATE`,
    )
    .catch((error: unknown) => {
      throw missingGapEntries(error) ? new GapEntriesMigrationPendingError(error) : error
    })
  const row = current.rows[0]
  if (row === undefined) {
    return 0
  }
  const stored = storedGapEntries({
    family,
    gaps: row.gaps,
    gapReason: row.gap_reason,
    gapEntries: row.gap_entries,
  })
  const entries = gaps.reduce(
    (acc, gap) =>
      addGapEntry(acc, {
        sources: gap.sources,
        from: gap.from,
        to: null,
        detectedAt: gap.detectedAt,
        reason: gap.reason,
      }),
    stored,
  )
  const columns = gapColumns(entries)
  const result = await tx
    .update(coverage)
    .set({
      gapEntries: sql`${columns.gapEntries}::jsonb`,
      gaps: sql`${columns.gaps}::datemultirange`,
      gapReason: columns.gapReason,
    })
    .where(eq(coverage.family, family))
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
        for (const [family, gaps] of Map.groupBy(command.gaps, (gap) => gap.family)) {
          gapRows += await addGaps(tx, family, gaps)
        }
        return { verifiedRows: await advanceVerifiedAt(tx, command), gapRows }
      })
    },
  }
}
