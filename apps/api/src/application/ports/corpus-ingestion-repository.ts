import type { Jurisdiction } from '@teko/shared/contracts'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type { Family, Modality, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import type {
  ParsedAmendment,
  ParsedDocumentMeta,
  ParsedDocumentVersion,
} from '#domain/corpus/parsed-source.ts'

/**
 * Escrita incremental do corpus pela ingestão (URL do owner, conexão direta). O caso de uso
 * `IngestDocumentVersion` orquestra uma unidade de trabalho por versão de documento
 * (`transaction`): nada fica visível até o commit, e a invariante de fonte publicada é conferida
 * antes dele. A reconciliação (o que reaproveitar, alargar, fechar ou inserir) é decidida na
 * aplicação; aqui ficam só as operações de banco.
 */

export const DocumentVersionStatus = {
  Ingesting: 'ingesting',
  Published: 'published',
  Superseded: 'superseded',
  Failed: 'failed',
} as const
export type DocumentVersionStatus =
  (typeof DocumentVersionStatus)[keyof typeof DocumentVersionStatus]

export interface ExistingDocumentVersion {
  readonly id: string
  readonly status: DocumentVersionStatus
  /** Revisão do parser que a produziu (ADR 0026). */
  readonly parserRevision: number
}

/** Redação com conhecimento aberto (`upper_inf(knowledge)`) de um dispositivo do documento. */
export interface OpenProvisionVersion {
  readonly id: string
  readonly stableKey: string
  readonly modality: Modality
  readonly reviewStatus: ReviewStatus
  readonly contentHash: string
  readonly validDuring: ValidityInterval
}

interface ProvisionRow {
  readonly stableKey: string
  readonly kind: string
  readonly parentStableKey: string | null
  readonly sortPath: string
}

interface NewChunkRow {
  readonly ordinal: number
  readonly content: string
  readonly contentHash: string
  readonly embedding: readonly number[]
}

export interface NewProvisionVersionRow {
  readonly provisionId: string
  readonly headingPath: string
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
  readonly amendment: ParsedAmendment | null
  readonly chunks: readonly NewChunkRow[]
}

export interface ReviewItemRow {
  readonly runId: string
  readonly provisionId: string
  readonly provisionVersionId: string
  readonly documentVersionId: string
  readonly stableKey: string
  readonly noteHash: string
  readonly reason: string
  readonly rawNote: string | null
  readonly proposed: ValidityInterval
}

export interface IngestionUnitOfWork {
  /** Cria ou atualiza o documento pelo `slug` e devolve o ID. */
  upsertDocument(
    document: ParsedDocumentMeta & { readonly jurisdiction: Jurisdiction },
  ): Promise<string>
  /** Grava a versão de documento com `status='ingesting'` (reaproveita a linha do mesmo sha256). */
  insertDocumentVersion(input: {
    readonly documentId: string
    readonly version: ParsedDocumentVersion
    readonly runId: string
    readonly blobRaw: string | null
    readonly blobDocling: string | null
    readonly parserRevision: number
  }): Promise<string>
  /**
   * Fecha em `from` o `valid_during` das outras versões do documento ainda em aberto que começam
   * antes dele (`[published_on, próxima consolidação)`). Devolve quantas fechou.
   */
  closePreviousDocumentVersions(
    documentId: string,
    documentVersionId: string,
    from: IsoDate,
  ): Promise<number>
  /** Cria ou atualiza os dispositivos (pais antes dos filhos); devolve `stable_key → id`. */
  upsertProvisions(
    documentId: string,
    provisions: readonly ProvisionRow[],
  ): Promise<ReadonlyMap<string, string>>
  /** Acrescenta rótulos históricos que ainda não existem. */
  addProvisionLabels(
    labels: readonly {
      readonly provisionId: string
      readonly label: string
      readonly validDuring: ValidityInterval
    }[],
  ): Promise<void>
  /** Redações com conhecimento aberto do documento, travadas até o commit. */
  lockOpenVersions(documentId: string): Promise<OpenProvisionVersion[]>
  /**
   * Fecha o `knowledge` (redação e chunks) em `at`, ou no dia seguinte ao início do conhecimento se
   * `at` não for posterior a ele (o intervalo nunca fica vazio).
   */
  closeKnowledge(ids: readonly string[], at: IsoDate): Promise<void>
  /**
   * Copia redações fechadas por `closeKnowledge` para os trechos de vigência que a versão nova não
   * reescreve, com conhecimento a partir do fechamento da original e os mesmos chunks (embeddings
   * inclusive) e fontes. Devolve os IDs novos, na ordem.
   */
  insertRemainders(
    rows: readonly { readonly sourceId: string; readonly validDuring: ValidityInterval }[],
  ): Promise<string[]>
  /** Troca o `valid_during` da redação e dos chunks dela. */
  widen(
    rows: readonly { readonly id: string; readonly validDuring: ValidityInterval }[],
  ): Promise<void>
  /** Insere redações novas (com alterações e chunks); devolve os IDs, na ordem. */
  insertVersions(
    rows: readonly NewProvisionVersionRow[],
    context: {
      readonly family: Family
      readonly jurisdiction: Jurisdiction
      readonly embeddingModel: string
    },
  ): Promise<string[]>
  /** Liga todos os chunks das redações à versão de documento (ignora pares já existentes). */
  addSources(provisionVersionIds: readonly string[], documentVersionId: string): Promise<void>
  /** Abre itens na fila de revisão, pulando `(stable_key, note_hash)` já abertos. Devolve quantos abriu. */
  enqueueReview(items: readonly ReviewItemRow[]): Promise<number>
  markPublished(documentVersionId: string): Promise<void>
  /** Todo chunk publicável do documento tem fonte publicada; lança se não. */
  assertPublishedSources(documentId: string): Promise<void>
}

interface RefreshCoverageRecord {
  readonly runId: string
  readonly verifiedAt: IsoDate
  /** Famílias a recalcular; `undefined` = as que tiveram versão publicada no run. */
  readonly families: readonly Family[] | undefined
  readonly notes: string
}

export interface CorpusIngestionRepository {
  findDocumentVersion(sha256: string): Promise<ExistingDocumentVersion | null>
  /** Leitura sem trava, para planejar os embeddings antes da transação. */
  openVersionsOf(slug: string): Promise<OpenProvisionVersion[]>
  transaction<T>(work: (uow: IngestionUnitOfWork) => Promise<T>): Promise<T>
  /**
   * Recalcula `coverage.covered` (união das vigências das redações publicáveis atuais),
   * `verified_at` e tira de `gap_entries` (e de `gaps`/`gap_reason`) as lacunas resolvidas por
   * versão de documento criada no run depois da detecção; grava um `corpus_versions` novo e
   * carimba os chunks ainda sem versão (`corpus_version = 0`). Sem família a recalcular, não grava
   * nada e devolve a versão atual.
   */
  refreshCoverage(record: RefreshCoverageRecord): Promise<{ readonly corpusVersion: number }>
  /** Estado publicado por documento, para o gate de saúde do fim do `load`. */
  documentHealth(): Promise<DocumentHealth[]>
  /** Itens abertos da fila de revisão por família e motivo (o resumo do `load` mostra). */
  openReviewQueue(): Promise<ReviewQueueCount[]>
}

/** Estado publicado de um documento (redações e chunks de conhecimento aberto). */
export interface DocumentHealth {
  readonly slug: string
  readonly family: string
  /** Dispositivos com redação publicável (`auto`/`approved`). */
  readonly provisions: number
  /** Chunks publicáveis. */
  readonly chunks: number
  /** Redações `pending`. */
  readonly pending: number
  /** Redações de todos os status. */
  readonly versions: number
}

export interface ReviewQueueCount {
  readonly family: string
  readonly reason: string
  readonly open: number
}

/** `corpus_version` dos chunks gravados pela ingestão até o `RefreshCoverage` do fim do run. */
export const UNVERSIONED_CORPUS = 0
