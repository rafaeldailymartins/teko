import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import type { DocumentHealth } from '../ports/corpus-ingestion-repository.ts'

/**
 * Gate de saúde do corpus no fim do `load`: por documento, o estado publicado agora contra o da
 * versão do corpus anterior (o `health` do `corpus.lock.json`, gravado só em run verde, então um
 * run que falhou no gate continua comparado com a mesma base no run seguinte). Uma queda de mais
 * de {@link HEALTH_LIMITS.maxDrop} nos dispositivos ou nos chunks de um documento, um documento que
 * sumiu, ou a fração `pending` de uma família acima do limite (e maior que antes) reprovam o run,
 * salvo `--accept-churn`.
 */

export const HEALTH_LIMITS = {
  maxDrop: 0.05,
  /** Padrão do `--max-pending-share`. */
  maxPendingShare: 0.15,
} as const

export interface HealthReport {
  readonly documents: readonly {
    readonly slug: string
    readonly family: string
    readonly before: DocumentHealth | null
    readonly after: DocumentHealth | null
  }[]
  readonly families: readonly {
    readonly family: string
    readonly pendingShare: number
    readonly pendingShareBefore: number | null
  }[]
  readonly violations: readonly string[]
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

function drop(before: number, after: number): number {
  return before === 0 ? 0 : (before - after) / before
}

function pendingShares(documents: readonly DocumentHealth[]): Map<string, number> {
  const totals = new Map<string, { pending: number; versions: number }>()
  for (const document of documents) {
    const total = totals.get(document.family) ?? { pending: 0, versions: 0 }
    totals.set(document.family, {
      pending: total.pending + document.pending,
      versions: total.versions + document.versions,
    })
  }
  return new Map(
    [...totals].map(([family, total]) => [
      family,
      total.versions === 0 ? 0 : total.pending / total.versions,
    ]),
  )
}

export function evaluateHealth(
  before: readonly DocumentHealth[] | null,
  after: readonly DocumentHealth[],
  limits: { readonly maxDrop: number; readonly maxPendingShare: number } = HEALTH_LIMITS,
): HealthReport {
  const beforeBySlug = new Map((before ?? []).map((document) => [document.slug, document]))
  const afterBySlug = new Map(after.map((document) => [document.slug, document]))
  const slugs = [...new Set([...beforeBySlug.keys(), ...afterBySlug.keys()])].sort(compareCodeUnits)
  const violations: string[] = []
  const documents = slugs.map((slug) => {
    const previous = beforeBySlug.get(slug) ?? null
    const current = afterBySlug.get(slug) ?? null
    if (previous !== null && current === null) {
      violations.push(`${slug}: sumiu do corpus publicado`)
    } else if (previous !== null && current !== null) {
      for (const field of ['provisions', 'chunks'] as const) {
        const fall = drop(previous[field], current[field])
        if (fall > limits.maxDrop) {
          violations.push(
            `${slug}: ${field} cai de ${String(previous[field])} para ${String(current[field])} ` +
              `(${percent(fall)} > ${percent(limits.maxDrop)})`,
          )
        }
      }
    }
    return { slug, family: (current ?? previous)?.family ?? '', before: previous, after: current }
  })
  const sharesBefore = before === null ? null : pendingShares(before)
  const families = [...pendingShares(after)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, pendingShare]) => {
      const pendingShareBefore = sharesBefore?.get(family) ?? null
      if (
        pendingShare > limits.maxPendingShare &&
        (pendingShareBefore === null || pendingShare > pendingShareBefore)
      ) {
        violations.push(
          `${family}: ${percent(pendingShare)} das redações em pending ` +
            `(limite ${percent(limits.maxPendingShare)}` +
            `${pendingShareBefore === null ? '' : `, antes ${percent(pendingShareBefore)}`})`,
        )
      }
      return { family, pendingShare, pendingShareBefore }
    })
  return { documents, families, violations }
}
