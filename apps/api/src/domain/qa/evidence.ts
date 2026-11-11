import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { containsDate } from '@teko/shared/vigencia'

/**
 * Evidência devolvida pela busca híbrida: um chunk com a vigência da redação (`chunks.valid_during`)
 * e a versão de documento escolhida para a citação (a publicada cuja vigência contém a data, ou o
 * snapshot publicado mais recente que contém o chunk).
 */
export interface Evidence {
  readonly chunkId: string
  readonly stableKey: string
  readonly family: string
  readonly citationLabel: string
  readonly content: string
  /** Vigência da redação citada (a que o usuário vê), nunca a do snapshot do documento. */
  readonly validity: ValidityInterval
  readonly document: {
    readonly versionId: string
    readonly versionLabel: string
    readonly title: string
    readonly sourceUrl: string
  }
  /** Pontuação RRF (k = 60) e posição em cada braço (`null` = ausente do braço). */
  readonly rrf: number
  readonly lexicalRank: number | null
  readonly semanticRank: number | null
  readonly referenceRank: number | null
}

/** Invariante da busca: toda evidência está em vigor na data de referência. */
export function isValidAt(evidence: Evidence, date: IsoDate): boolean {
  return containsDate(evidence.validity, date)
}

/** Maior RRF da lista (0 se vazia), comparado com `MIN_EVIDENCE_RRF` para recusar sem LLM. */
export function maxRrf(evidence: readonly Evidence[]): number {
  return evidence.reduce((max, item) => Math.max(max, item.rrf), 0)
}
