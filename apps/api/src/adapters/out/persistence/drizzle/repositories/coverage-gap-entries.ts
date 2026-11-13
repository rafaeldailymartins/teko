import { fromPostgresMultirange, isoDateSchema, toPostgresMultirange } from '@teko/shared/vigencia'
import { z } from 'zod'
import { type CoverageGapEntry, summarizeGaps } from '#domain/corpus/coverage-gaps.ts'

/**
 * `corpus.coverage.gap_entries` (jsonb) de/para o domínio, e as três colunas que andam juntas:
 * `gap_entries`, `gaps` (soma das vigências) e `gap_reason` (soma dos motivos).
 */

const entrySchema = z.object({
  sources: z.array(z.string().min(1)),
  from: isoDateSchema,
  to: isoDateSchema.nullable(),
  detectedAt: z.string().nullable(),
  reason: z.string(),
})

const entriesSchema = z.array(entrySchema)

class CoverageGapEntriesError extends Error {
  constructor(family: string, cause: unknown) {
    super(`gap_entries inválido na cobertura de ${family}`, { cause })
    this.name = 'CoverageGapEntriesError'
  }
}

/** Lê o jsonb (o `pg` já entrega o valor decodificado; `null` = sem entradas). */
function parseGapEntries(family: string, value: unknown): CoverageGapEntry[] {
  const parsed = entriesSchema.safeParse(value ?? [])
  if (!parsed.success) {
    throw new CoverageGapEntriesError(family, parsed.error)
  }
  return parsed.data
}

/** As três colunas de lacuna, como lidas (`gaps` em texto). */
export interface StoredGaps {
  readonly family: string
  readonly gaps: string
  readonly gapReason: string | null
  /** `null` num snapshot anterior às entradas. */
  readonly gapEntries: unknown
}

const LEGACY_GAP_REASON = 'lacuna anterior ao registro por entrada'

/**
 * Entradas de uma linha de cobertura. Sem entradas e com `gaps` (linha gravada por um caminho que
 * só conhece `gaps`, como a fixture, ou snapshot anterior à coluna), cada trecho vira uma entrada
 * sem documento e sem detecção, como na migração.
 */
export function storedGapEntries(stored: StoredGaps): CoverageGapEntry[] {
  const entries = parseGapEntries(stored.family, stored.gapEntries)
  if (entries.length > 0) {
    return entries
  }
  return fromPostgresMultirange(stored.gaps).map((interval) => ({
    sources: [],
    from: interval.from ?? '0001-01-01',
    to: interval.to,
    detectedAt: null,
    reason: stored.gapReason ?? LEGACY_GAP_REASON,
  }))
}

export interface GapColumns {
  /** JSON para `::jsonb`. */
  readonly gapEntries: string
  /** Texto para `::datemultirange`. */
  readonly gaps: string
  readonly gapReason: string | null
}

export function gapColumns(entries: readonly CoverageGapEntry[]): GapColumns {
  const summary = summarizeGaps(entries)
  return {
    gapEntries: JSON.stringify(entries),
    gaps: toPostgresMultirange(summary.gaps),
    gapReason: summary.reason,
  }
}
