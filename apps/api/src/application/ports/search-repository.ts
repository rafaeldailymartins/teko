import type { IsoDate } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import type { Evidence } from '#domain/qa/evidence.ts'

/**
 * Busca híbrida numa só instrução SQL (léxica + vetorial + referência exata, fundidas por RRF
 * k = 60), filtrada por vigência (`valid_during @> data`), conhecimento atual, família e status de
 * revisão. Sem `embedding`, roda a variante `lexical_only`.
 */
export interface SearchQuery {
  /** Pergunta já redigida (vira `tsquery` com OR dos lexemas). */
  readonly text: string
  /** Vetor da pergunta; `null` = `lexical_only`. */
  readonly embedding: readonly number[] | null
  readonly referenceDate: IsoDate
  readonly families: readonly string[]
  /** `stable_key` citadas na pergunta (braço `exact`). */
  readonly stableKeys: readonly string[]
  /** Produção: `auto` e `approved`; staging inclui `pending`. */
  readonly reviewStatuses: readonly ReviewStatus[]
  readonly limit: number
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<Evidence[]>
}
