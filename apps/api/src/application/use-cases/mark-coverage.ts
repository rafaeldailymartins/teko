import { compareIsoDates, type IsoDate } from '@teko/shared/vigencia'
import type {
  CoverageWatchRepository,
  FamilyGap,
  MarkVerifiedResult,
} from '../ports/watch-coverage-repository.ts'
import type { DiscoveredChange, DiscoveredReport } from '../ports/watch-report.ts'

/**
 * `MarkCoverage` (job `mark-coverage` do `source-watch.yml`, environment `corpus-watch`, role
 * `teko_watch`): avança o `verified_at` de toda família verificada no run e, para as famílias com
 * mudança detectada, acrescenta a lacuna `[effectiveFrom, ∞)` e grava o `gap_reason`.
 *
 * Sem mudança e sem erro de verificação, o repositório executa exatamente um
 * `UPDATE corpus.coverage SET verified_at = <data do run> WHERE verified_at < <data do run>`.
 * Sem esse avanço diário, o `CheckCoverage` recusaria como `out_of_coverage` toda data posterior à
 * última mudança detectada. A lacuna começa na menor data de efeito detectada da família, e o
 * `gap_reason` lista o que mudou (até {@link GAP_REASON_MAX} caracteres).
 */

export const GAP_REASON_MAX = 500

export interface MarkCoverageCommand {
  readonly report: DiscoveredReport
}

export interface MarkCoverageTargetResult extends MarkVerifiedResult {
  readonly verifiedAt: IsoDate
  readonly gaps: readonly FamilyGap[]
  readonly excludedFamilies: readonly string[]
}

function describe(change: DiscoveredChange): string {
  const label = change.versionLabel ?? change.sourceUrl
  const suffix = change.status === 'pending' ? ', ainda não consolidado' : ''
  return `${label} (desde ${change.effectiveFrom}${suffix})`
}

function truncate(text: string): string {
  return text.length <= GAP_REASON_MAX ? text : `${text.slice(0, GAP_REASON_MAX - 1)}…`
}

/** Uma lacuna por família com mudança, a partir da menor data de efeito detectada. */
export function gapsFromReport(report: DiscoveredReport): FamilyGap[] {
  const byFamily = new Map<string, { from: IsoDate; changes: DiscoveredChange[] }>()
  for (const item of report.changes) {
    const group = byFamily.get(item.family)
    if (group === undefined) {
      byFamily.set(item.family, { from: item.effectiveFrom, changes: [item] })
    } else {
      group.changes.push(item)
      if (compareIsoDates(item.effectiveFrom, group.from) < 0) {
        group.from = item.effectiveFrom
      }
    }
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, { from, changes }]) => {
      const ordered = [...changes].sort((a, b) => compareIsoDates(a.effectiveFrom, b.effectiveFrom))
      const details = [...new Set(ordered.map(describe))].join('; ')
      return {
        family,
        from,
        reason: truncate(`Mudança detectada pelo source-watch em ${report.runDate}: ${details}`),
      }
    })
}

export async function markCoverage(
  repository: CoverageWatchRepository,
  command: MarkCoverageCommand,
): Promise<MarkCoverageTargetResult> {
  const { report } = command
  const gaps = gapsFromReport(report)
  const excludedFamilies = [...report.unverifiedFamilies]
  const result = await repository.markVerified({
    verifiedAt: report.runDate,
    excludeFamilies: excludedFamilies,
    gaps,
  })
  return { ...result, verifiedAt: report.runDate, gaps, excludedFamilies }
}
