import {
  type PeriodoApuracao,
  periodoApuracaoInterval,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'
import { periodBoundaryScopes } from '#domain/vigencia/reference-resolution.ts'
import type { SearchRepository } from '../ports/search-repository.ts'

/**
 * `FindPeriodVersions`: vigências com fronteira dentro do mês do PA, nas unidades (artigo,
 * registro, evento...) das evidências e das chaves citadas. Completa o aviso de fronteira do
 * `RetrieveEvidence`: a busca roda no dia 1 e não enxerga o que começa depois dele no mesmo mês.
 */
interface FindPeriodVersionsCommand {
  readonly periodo: PeriodoApuracao
  /** Famílias em que a busca rodou (as cobertas). */
  readonly families: readonly string[]
  /** Chaves das evidências e as citadas na pergunta. */
  readonly stableKeys: readonly string[]
}

export type FindPeriodVersions = (command: FindPeriodVersionsCommand) => Promise<ValidityInterval[]>

export function createFindPeriodVersions(deps: {
  readonly searchRepository: SearchRepository
  readonly reviewStatuses: readonly ReviewStatus[]
}): FindPeriodVersions {
  return async ({ periodo, families, stableKeys }) => {
    const scopes = periodBoundaryScopes(stableKeys)
    if (scopes.length === 0 || families.length === 0) {
      return []
    }
    return deps.searchRepository.versionsInPeriod({
      period: periodoApuracaoInterval(periodo),
      scopes,
      families,
      reviewStatuses: deps.reviewStatuses,
    })
  }
}
