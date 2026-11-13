import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
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

/**
 * Vigências que cruzam um período (o mês do PA), com os mesmos filtros da busca (conhecimento
 * atual, família, status de revisão), dos dispositivos sob as unidades `scopes` (a própria chave ou
 * as descendentes dela). Serve ao aviso de fronteira dentro do PA.
 */
export interface PeriodVersionsQuery {
  readonly period: ValidityInterval
  readonly scopes: readonly string[]
  readonly families: readonly string[]
  readonly reviewStatuses: readonly ReviewStatus[]
}

export interface SearchRepository {
  search(query: SearchQuery): Promise<Evidence[]>
  /** Vigências distintas (`valid_during`) das redações que cruzam o período. */
  versionsInPeriod(query: PeriodVersionsQuery): Promise<ValidityInterval[]>
}
