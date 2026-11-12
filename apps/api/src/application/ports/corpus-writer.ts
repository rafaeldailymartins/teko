import type { Jurisdiction } from '@teko/shared/contracts'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type {
  ChangeKind,
  Family,
  Modality,
  ReviewStatus,
  ValidityBasis,
} from '#domain/corpus/family.ts'

/**
 * Escrita do corpus (owner, conexão direta). Uma chamada = uma transação: documentos, versões,
 * dispositivos, redações, chunks e fontes; depois a cobertura e um novo `corpus_versions`. Se algo
 * falhar, nada fica visível. A invariante "todo chunk publicável tem fonte `published`" é conferida
 * antes do commit.
 *
 * Usada pelo `WriteCorpus` (seed da fixture, hoje; ingestão e promoção, a partir da F3).
 */

export interface DocumentVersionRecord {
  readonly key: string
  readonly versionLabel: string
  readonly publishedOn: IsoDate
  readonly validDuring: ValidityInterval
  readonly consolidatedUntil: string | null
  readonly actRef: string | null
  readonly sha256: string
}

export interface AmendmentRecord {
  readonly actLabel: string
  readonly actKind: string
  readonly actDate: IsoDate
  readonly effectiveFrom: IsoDate
  readonly changeKind: ChangeKind
  readonly rawNote: string
}

export interface ChunkRecord {
  readonly ordinal: number
  readonly content: string
  readonly contentHash: string
  /** `null` = sem embedding (só busca léxica até o `EmbedPending`). */
  readonly embedding: readonly number[] | null
}

export interface ProvisionVersionRecord {
  readonly displayLabel: string
  readonly validDuring: ValidityInterval
  readonly knowledge: ValidityInterval
  readonly modality: Modality
  readonly validityBasis: ValidityBasis
  readonly retroactive: boolean
  readonly reviewStatus: ReviewStatus
  readonly text: string
  readonly contentHash: string
  readonly structured: Readonly<Record<string, unknown>> | null
  readonly amendment: AmendmentRecord | null
  readonly documentVersionKeys: readonly string[]
  readonly chunks: readonly ChunkRecord[]
}

interface ProvisionRecord {
  readonly stableKey: string
  readonly kind: string
  readonly parentStableKey: string | null
  readonly sortPath: string
  readonly headingPath: string
  readonly versions: readonly ProvisionVersionRecord[]
}

export interface DocumentRecord {
  readonly slug: string
  readonly family: Family
  readonly jurisdiction: Jurisdiction
  readonly title: string
  readonly issuer: string
  readonly sourceUrl: string
  readonly versions: readonly DocumentVersionRecord[]
  readonly provisions: readonly ProvisionRecord[]
}

interface CoverageRecord {
  readonly family: Family
  readonly jurisdiction: Jurisdiction
  readonly covered: readonly ValidityInterval[]
  readonly verifiedAt: IsoDate
  readonly gaps: readonly ValidityInterval[]
  readonly gapReason: string | null
}

export interface CorpusSnapshot {
  readonly documents: readonly DocumentRecord[]
  readonly coverage: readonly CoverageRecord[]
  readonly embeddingModel: string
  readonly notes: string
  /** Esvazia o schema `corpus` na mesma transação, antes de gravar. */
  readonly replace: boolean
}

export interface CorpusWriteResult {
  readonly corpusVersion: number
  readonly documents: number
  readonly provisionVersions: number
  readonly chunks: number
}

export interface CorpusWriter {
  write(snapshot: CorpusSnapshot): Promise<CorpusWriteResult>
}
