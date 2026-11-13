import {
  compareIsoDates,
  type IsoDate,
  mergeIntervals,
  type ValidityInterval,
} from '@teko/shared/vigencia'

/**
 * Lacunas de cobertura por entrada (`corpus.coverage.gap_entries`). Cada mudança detectada pelo
 * `source-watch` vira uma entrada com a vigência que ficou descoberta, os documentos (slug) cuja
 * publicação a resolve e o instante da detecção. `gaps` e `gap_reason`, que o `CheckCoverage` lê,
 * são sempre a soma das entradas ({@link summarizeGaps}).
 *
 * - A ingestão limpa só a entrada cujo documento ganhou, no run, uma versão criada depois da
 *   detecção (uma revisão de parser que reprocessa um Guia antigo não limpa a lacuna do Guia novo).
 * - A promoção decide pela detecção: a produção adota as entradas do snapshot e só mantém as suas
 *   detectadas depois da exportação do snapshot; as anteriores o staging já viu e resolveu.
 */

/** Teto do `gap_reason` (o motivo é exibido na recusa `out_of_coverage`). */
export const GAP_REASON_MAX = 500

export interface CoverageGapEntry {
  /** Documentos (slug) cuja publicação resolve a lacuna; vazio = qualquer documento da família. */
  readonly sources: readonly string[]
  /** Vigência descoberta: `[from, to)`, `to` nulo = sem fim. */
  readonly from: IsoDate
  readonly to: IsoDate | null
  /**
   * Instante da detecção (`generatedAt` do `discovered.json`, ISO 8601 com fuso). `null` = lacuna
   * gravada antes do registro por entrada: vale como detectada antes de qualquer snapshot.
   */
  readonly detectedAt: string | null
  readonly reason: string
}

/** Versão de documento publicada num run, com o instante em que foi criada no banco. */
export interface PublishedDocumentVersion {
  readonly slug: string
  readonly createdAt: string
}

const sourcesKey = (sources: readonly string[]) => [...sources].sort().join('\n')

function instant(value: string): number {
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    throw new RangeError(`instante inválido: ${value}`)
  }
  return time
}

/** O mais antigo dos dois (`null` é o mais antigo de todos). */
function earliest(a: string | null, b: string | null): string | null {
  if (a === null || b === null) {
    return null
  }
  return instant(a) <= instant(b) ? a : b
}

function laterEnd(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null || b === null) {
    return null
  }
  return compareIsoDates(a, b) >= 0 ? a : b
}

/**
 * Acrescenta a entrada; a que já existe com os mesmos documentos é alargada (menor `from`, maior
 * `to`) e mantém a detecção mais antiga, com o motivo mais recente.
 */
export function addGapEntry(
  entries: readonly CoverageGapEntry[],
  entry: CoverageGapEntry,
): CoverageGapEntry[] {
  const key = sourcesKey(entry.sources)
  const index = entries.findIndex((existing) => sourcesKey(existing.sources) === key)
  const current = entries[index]
  if (current === undefined) {
    return [...entries, { ...entry, sources: [...entry.sources].sort() }]
  }
  const merged: CoverageGapEntry = {
    sources: current.sources,
    from: compareIsoDates(entry.from, current.from) < 0 ? entry.from : current.from,
    to: laterEnd(current.to, entry.to),
    detectedAt: earliest(current.detectedAt, entry.detectedAt),
    reason: entry.reason,
  }
  return entries.map((existing, position) => (position === index ? merged : existing))
}

/** A entrada é resolvida por uma versão de um dos documentos dela, criada depois da detecção. */
function resolvedBy(entry: CoverageGapEntry, version: PublishedDocumentVersion): boolean {
  const covers = entry.sources.length === 0 || entry.sources.includes(version.slug)
  return (
    covers && (entry.detectedAt === null || instant(version.createdAt) >= instant(entry.detectedAt))
  )
}

/** Entradas que continuam abertas depois de um run que publicou `published`. */
export function clearResolvedGaps(
  entries: readonly CoverageGapEntry[],
  published: readonly PublishedDocumentVersion[],
): CoverageGapEntry[] {
  return entries.filter((entry) => !published.some((version) => resolvedBy(entry, version)))
}

/**
 * Lacunas da produção depois de promover um snapshot exportado em `snapshotCreatedAt`: as do
 * snapshot, mais as do destino detectadas depois da exportação (o staging ainda não as viu).
 */
export function mergeGapsForPromotion(
  snapshot: readonly CoverageGapEntry[],
  target: readonly CoverageGapEntry[],
  snapshotCreatedAt: string,
): CoverageGapEntry[] {
  const exportedAt = instant(snapshotCreatedAt)
  const newer = target.filter(
    (entry) => entry.detectedAt !== null && instant(entry.detectedAt) > exportedAt,
  )
  return newer.reduce<CoverageGapEntry[]>(addGapEntry, [...snapshot])
}

export interface GapSummary {
  /** União das vigências descobertas (`coverage.gaps`). */
  readonly gaps: ValidityInterval[]
  /** Motivos, sem repetição, até {@link GAP_REASON_MAX} caracteres (`coverage.gap_reason`). */
  readonly reason: string | null
}

export function summarizeGaps(entries: readonly CoverageGapEntry[]): GapSummary {
  if (entries.length === 0) {
    return { gaps: [], reason: null }
  }
  const reason = [...new Set(entries.map((entry) => entry.reason))].join('; ')
  return {
    gaps: mergeIntervals(entries.map((entry) => ({ from: entry.from, to: entry.to }))),
    reason: reason.length <= GAP_REASON_MAX ? reason : `${reason.slice(0, GAP_REASON_MAX - 1)}…`,
  }
}
