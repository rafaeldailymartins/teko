import { compareIsoDates, type IsoDate } from '@teko/shared/vigencia'
import { GAP_REASON_MAX } from '#domain/corpus/coverage-gaps.ts'
import type {
  CoverageWatchRepository,
  FamilyGap,
  MarkVerifiedResult,
} from '../ports/watch-coverage-repository.ts'
import type { DiscoveredChange, DiscoveredReport } from '../ports/watch-report.ts'

/**
 * `MarkCoverage` (job `mark-coverage` do `source-watch.yml`, environment `corpus-watch`, role
 * `teko_watch`): avança o `verified_at` de toda família verificada no run e, para as famílias com
 * mudança detectada, acrescenta a lacuna `[effectiveFrom, ∞)` como entrada de `gap_entries`, com
 * os documentos que a resolvem (`covers` da página do `corpus/watch.yaml`) e o instante da
 * detecção (`generatedAt` do relatório).
 *
 * Sem mudança e sem erro de verificação, o repositório executa exatamente um
 * `UPDATE corpus.coverage SET verified_at = <data do run> WHERE verified_at < <data do run>`.
 * Sem esse avanço diário, o `CheckCoverage` recusaria como `out_of_coverage` toda data posterior à
 * última mudança detectada. A lacuna começa na menor data de efeito detectada da família (por
 * conjunto de documentos), e o motivo lista o que mudou (até {@link GAP_REASON_MAX} caracteres).
 */

export { GAP_REASON_MAX }

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

const coversOf = (change: DiscoveredChange): string[] => [...(change.covers ?? [])].sort()

/**
 * Uma lacuna por família e conjunto de documentos com mudança, a partir da menor data de efeito
 * detectada.
 */
export function gapsFromReport(report: DiscoveredReport): FamilyGap[] {
  const groups = Map.groupBy(
    report.changes,
    (item) => `${item.family}\u0000${coversOf(item).join('\u0000')}`,
  )
  return [...groups.values()]
    .flatMap((changes) => {
      const ordered = [...changes].sort((a, b) => compareIsoDates(a.effectiveFrom, b.effectiveFrom))
      const [first] = ordered
      if (first === undefined) {
        return []
      }
      const details = [...new Set(ordered.map(describe))].join('; ')
      return [
        {
          family: first.family,
          from: first.effectiveFrom,
          reason: truncate(`Mudança detectada pelo source-watch em ${report.runDate}: ${details}`),
          sources: coversOf(first),
          detectedAt: report.generatedAt,
        },
      ]
    })
    .sort(
      (a, b) =>
        a.family.localeCompare(b.family) || a.sources.join(',').localeCompare(b.sources.join(',')),
    )
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
