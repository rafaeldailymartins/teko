import type { Jurisdiction } from '@teko/shared/contracts'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type { ReviewStatus } from '#domain/corpus/family.ts'

/**
 * Leitura do corpus publicado para a paleta, a linha do tempo e o diff de um dispositivo. Os
 * filtros são os mesmos da busca: conhecimento atual (`upper_inf(knowledge)`) e `review_status`
 * do ambiente.
 */
interface ProvisionSearchQuery {
  readonly text: string
  readonly family: string | null
  readonly at: IsoDate
  readonly reviewStatuses: readonly ReviewStatus[]
  readonly limit: number
}

export interface ProvisionMatch {
  readonly stableKey: string
  readonly label: string
  readonly family: string
  readonly jurisdiction: Jurisdiction
  readonly validity: ValidityInterval
  readonly text: string
}

export interface ProvisionVersionRecord {
  readonly label: string
  readonly validity: ValidityInterval
  readonly text: string
  readonly act: string | null
  readonly structured: Readonly<Record<string, unknown>> | null
}

export interface ProvisionHistory {
  readonly stableKey: string
  readonly family: string
  readonly jurisdiction: Jurisdiction
  /** Ordenadas pelo início da vigência. */
  readonly versions: readonly ProvisionVersionRecord[]
}

export interface ProvisionRepository {
  search(query: ProvisionSearchQuery): Promise<ProvisionMatch[]>
  /** `null` quando a chave não existe (ou não tem redação publicada no ambiente). */
  history(
    stableKey: string,
    reviewStatuses: readonly ReviewStatus[],
  ): Promise<ProvisionHistory | null>
}
