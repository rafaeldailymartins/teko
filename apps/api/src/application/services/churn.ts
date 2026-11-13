import { overlaps, type ValidityInterval } from '@teko/shared/vigencia'
import { ReviewStatus } from '#domain/corpus/family.ts'
import type { OpenProvisionVersion } from '../ports/corpus-ingestion-repository.ts'

/**
 * Disjuntor de mudança em massa na reconciliação (ADR 0025, onde a janela de um consolidado é o
 * documento inteiro): um parser quebrado, uma página truncada ou um TableFormer que funde linhas
 * fecham de uma vez boa parte do que estava publicado. Antes de embutir e de gravar, a versão é
 * comparada com as redações abertas que cruzam a janela; acima dos limites, o item falha (o run
 * fecha `failed`, sem snapshot nem PR do lock), a menos que o run tenha `--accept-churn`.
 */

export const CHURN_LIMITS = {
  /** Fração das redações abertas na janela que a versão fecha. */
  maxClosedShare: 0.2,
  /** Fração dos dispositivos com redação aberta na janela que somem. */
  maxProvisionLoss: 0.1,
  /** A fração de `pending` pode no máximo dobrar (e subir menos de 2 pontos percentuais). */
  maxPendingGrowth: 2,
  minPendingIncrease: 0.02,
  /** Abaixo disto (redações abertas na janela), não há base para comparar. */
  minBaseline: 20,
} as const

export interface ChurnMetrics {
  /** Redações abertas que cruzam a janela antes da versão. */
  readonly openBefore: number
  /** Dessas, quantas a versão fecha. */
  readonly closed: number
  /** Redações novas da versão. */
  readonly inserted: number
  /** Dispositivos com redação aberta na janela antes da versão. */
  readonly provisionsBefore: number
  /** Desses, quantos ficam sem nenhuma redação aberta. */
  readonly provisionsLost: number
  /** Fração `pending` antes (redações abertas na janela) e depois (redações parseadas). */
  readonly pendingShareBefore: number
  readonly pendingShareAfter: number
}

interface ChurnInput {
  readonly existing: readonly OpenProvisionVersion[]
  readonly window: ValidityInterval
  readonly close: readonly string[]
  readonly remainders: readonly { readonly sourceId: string }[]
  readonly insert: number
  readonly provisions: readonly {
    readonly stableKey: string
    readonly versions: readonly { readonly reviewStatus: ReviewStatus }[]
  }[]
}

const share = (part: number, total: number) => (total === 0 ? 0 : part / total)

export function measureChurn(input: ChurnInput): ChurnMetrics {
  const inWindow = input.existing.filter((row) => overlaps(row.validDuring, input.window))
  const keyOf = new Map(input.existing.map((row) => [row.id, row.stableKey]))
  const before = new Set(inWindow.map((row) => row.stableKey))
  const after = new Set([
    ...input.provisions
      .filter((provision) => provision.versions.length > 0)
      .map((provision) => provision.stableKey),
    ...input.remainders.flatMap((row) => keyOf.get(row.sourceId) ?? []),
  ])
  const parsed = input.provisions.flatMap((provision) => provision.versions)
  return {
    openBefore: inWindow.length,
    closed: input.close.length,
    inserted: input.insert,
    provisionsBefore: before.size,
    provisionsLost: [...before].filter((key) => !after.has(key)).length,
    pendingShareBefore: share(
      inWindow.filter((row) => row.reviewStatus === ReviewStatus.Pending).length,
      inWindow.length,
    ),
    pendingShareAfter: share(
      parsed.filter((version) => version.reviewStatus === ReviewStatus.Pending).length,
      parsed.length,
    ),
  }
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

/** Limites ultrapassados, em texto para o relatório; vazio = dentro dos limites. */
export function churnViolations(metrics: ChurnMetrics): string[] {
  if (metrics.openBefore < CHURN_LIMITS.minBaseline) {
    return []
  }
  const violations: string[] = []
  const closedShare = share(metrics.closed, metrics.openBefore)
  if (closedShare > CHURN_LIMITS.maxClosedShare) {
    violations.push(
      `fecha ${String(metrics.closed)} de ${String(metrics.openBefore)} redações abertas na janela ` +
        `(${percent(closedShare)} > ${percent(CHURN_LIMITS.maxClosedShare)})`,
    )
  }
  const lostShare = share(metrics.provisionsLost, metrics.provisionsBefore)
  if (lostShare > CHURN_LIMITS.maxProvisionLoss) {
    violations.push(
      `${String(metrics.provisionsLost)} de ${String(metrics.provisionsBefore)} dispositivos ficam sem ` +
        `redação aberta (${percent(lostShare)} > ${percent(CHURN_LIMITS.maxProvisionLoss)})`,
    )
  }
  const { pendingShareBefore: before, pendingShareAfter: after } = metrics
  if (
    after >= before * CHURN_LIMITS.maxPendingGrowth &&
    after - before >= CHURN_LIMITS.minPendingIncrease
  ) {
    violations.push(`pending passa de ${percent(before)} para ${percent(after)} das redações`)
  }
  return violations
}

export class ChurnLimitError extends Error {
  readonly metrics: ChurnMetrics
  readonly violations: readonly string[]

  constructor(slug: string, metrics: ChurnMetrics, violations: readonly string[]) {
    super(
      `mudança em massa em ${slug}: ${violations.join('; ')} ` +
        '(confira o parser; se for legítima, rode com --accept-churn)',
    )
    this.name = 'ChurnLimitError'
    this.metrics = metrics
    this.violations = violations
  }
}
