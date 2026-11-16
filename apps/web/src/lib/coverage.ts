import type { FamilyCoverage, Jurisdiction } from '@teko/shared/contracts'
import {
  addDays,
  compareIsoDates,
  createInterval,
  type IsoDate,
  mergeIntervals,
  toEpochDay,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Página de cobertura: a cobertura efetiva de cada família (`GET /api/v1/coverage`, já limitada
 * pela última verificação e sem as lacunas) vira períodos cobertos, lacunas entre eles e uma barra
 * proporcional numa escala comum a todas as famílias. Tudo é derivado do contrato: a API não
 * manda as lacunas à parte.
 */

/** Famílias com nome e fontes no catálogo (`coverage.families.<chave>`); as outras mostram o slug. */
const FAMILY_MESSAGE_KEYS = {
  'efd-icms-ipi': 'efdIcmsIpi',
  'efd-reinf': 'efdReinf',
  rcte: 'rcte',
  cte: 'cte',
  'efd-go': 'efdGo',
  'tabelas-go': 'tabelasGo',
  'rcte-anexos': 'rcteAnexos',
} as const
export type FamilyMessageKey = (typeof FAMILY_MESSAGE_KEYS)[keyof typeof FAMILY_MESSAGE_KEYS]

export function familyMessageKey(family: string): FamilyMessageKey | null {
  return Object.hasOwn(FAMILY_MESSAGE_KEYS, family)
    ? FAMILY_MESSAGE_KEYS[family as keyof typeof FAMILY_MESSAGE_KEYS]
    : null
}

/** Trechos sem cobertura entre dois períodos cobertos (a cobertura efetiva já vem sem as lacunas). */
export function coverageGaps(covered: readonly ValidityInterval[]): ValidityInterval[] {
  const merged = mergeIntervals(covered)
  const gaps: ValidityInterval[] = []
  for (let index = 1; index < merged.length; index += 1) {
    const before = merged[index - 1]
    const after = merged[index]
    if (before?.to != null && after?.from != null && before.to < after.from) {
      gaps.push(createInterval(before.to, after.from))
    }
  }
  return gaps
}

/** A verificação mais recente entre as famílias (`null` sem famílias). */
export function lastVerification(families: readonly FamilyCoverage[]): IsoDate | null {
  return families.reduce<IsoDate | null>(
    (latest, family) =>
      latest === null || family.verifiedAt > latest ? family.verifiedAt : latest,
    null,
  )
}

// Literais, não o enum: importar valor de `@teko/shared/contracts` traria os schemas do Zod para a página.
const JURISDICTION_ORDER: readonly Jurisdiction[] = ['BR', 'GO']

export interface JurisdictionGroup {
  readonly jurisdiction: Jurisdiction
  readonly families: readonly FamilyCoverage[]
}

/** Famílias agrupadas por jurisdição (federal antes de Goiás), na ordem da API dentro do grupo. */
export function groupByJurisdiction(families: readonly FamilyCoverage[]): JurisdictionGroup[] {
  return JURISDICTION_ORDER.map((jurisdiction) => ({
    jurisdiction,
    families: families.filter((family) => family.jurisdiction === jurisdiction),
  })).filter((group) => group.families.length > 0)
}

/** Escala comum das barras: do começo mais antigo ao dia seguinte à verificação mais recente. */
export interface CoverageScale {
  readonly from: IsoDate
  readonly to: IsoDate
}

export function coverageScale(families: readonly FamilyCoverage[]): CoverageScale | null {
  const latest = lastVerification(families)
  const from = families
    .flatMap((family) => family.covered.map((interval) => interval.from))
    .filter((start): start is IsoDate => start !== null)
    .toSorted(compareIsoDates)[0]
  if (latest === null || from === undefined) {
    return null
  }
  const to = addDays(latest, 1)
  return from < to ? { from, to } : null
}

export const SegmentKind = {
  Covered: 'covered',
  Gap: 'gap',
} as const
export type SegmentKind = (typeof SegmentKind)[keyof typeof SegmentKind]

/** Trecho da barra, em porcentagem da escala (para `style.left`/`style.width`). */
export interface CoverageSegment {
  readonly kind: SegmentKind
  readonly start: number
  readonly width: number
}

function clampedSegment(
  kind: SegmentKind,
  interval: ValidityInterval,
  scale: CoverageScale,
): CoverageSegment | null {
  const origin = toEpochDay(scale.from)
  const total = toEpochDay(scale.to) - origin
  const start = Math.max(interval.from === null ? 0 : toEpochDay(interval.from) - origin, 0)
  const end = Math.min(interval.to === null ? total : toEpochDay(interval.to) - origin, total)
  if (end <= start) {
    return null
  }
  const round = (value: number) => Math.round((value / total) * 10_000) / 100
  return { kind, start: round(start), width: round(end - start) }
}

/** Trechos cobertos e lacunas de uma família na escala comum, em ordem. */
export function coverageSegments(
  covered: readonly ValidityInterval[],
  scale: CoverageScale,
): CoverageSegment[] {
  const pieces = [
    ...mergeIntervals(covered).map((interval) => ({ kind: SegmentKind.Covered, interval })),
    ...coverageGaps(covered).map((interval) => ({ kind: SegmentKind.Gap, interval })),
  ]
  return pieces
    .map(({ kind, interval }) => clampedSegment(kind, interval, scale))
    .filter((segment): segment is CoverageSegment => segment !== null)
    .sort((a, b) => a.start - b.start)
}
