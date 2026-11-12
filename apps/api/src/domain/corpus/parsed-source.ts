import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type { ChangeKind, Family, Modality, ReviewStatus, ValidityBasis } from './family.ts'

/**
 * Saída dos parsers da ingestão (`adapters/in/cli/ingest/parsers/`): uma versão de documento (um
 * arquivo-fonte, identificado pelo sha256) com os dispositivos e as redações que ela contém. É o
 * contrato entre os parsers, as regras de vigência (`validity.ts`, `leiaute-validity.ts`) e o caso
 * de uso `IngestDocumentVersion`, que reconcilia com o que já está no banco.
 *
 * O formato espelha o da fixture (`seed-fixtures/fixture-schema.ts`), sem `documentVersions` nas
 * redações: toda redação de um `ParsedSource` pertence à versão de documento dele.
 */

export interface ParsedAmendment {
  /** Ex.: "Decreto nº 6.026, de 27.10.04". */
  readonly actLabel: string
  /** Ex.: "decreto", "lei", "ato-cotepe", "nota-tecnica". */
  readonly actKind: string
  readonly actDate: IsoDate
  readonly effectiveFrom: IsoDate
  readonly changeKind: ChangeKind
  /** Nota da fonte, como publicada. */
  readonly rawNote: string
}

/** Motivo de uma redação ir para a `review_queue` (anomalia de vigência). */
export interface ReviewFlag {
  /** Código curto e estável, ex.: `note-unparsed`, `style-mismatch`, `exhausted-ambiguous`. */
  readonly reason: string
  /** Nota original que gerou a dúvida, quando houver. */
  readonly rawNote: string | null
}

export interface ParsedVersion {
  /** Rótulo exibido na data (ex.: "RCTE, art. 76, § 6º"); vira o `citation_label` do chunk. */
  readonly displayLabel: string
  /** Meio-aberto, com limite inferior; `to: null` = vigente. Nunca vazio. */
  readonly validDuring: ValidityInterval
  readonly modality: Modality
  readonly validityBasis: ValidityBasis
  readonly retroactive: boolean
  /**
   * `auto` na regra geral; `pending` quando `review` está presente (anomalia visível no staging e
   * fora da produção). Os parsers nunca emitem `approved`/`rejected`: isso vem dos overrides.
   */
  readonly reviewStatus: ReviewStatus
  readonly review?: ReviewFlag | undefined
  readonly text: string
  /** Dados estruturados (ex.: campo do Guia: número, nome, tipo, tamanho, obrigatoriedade). */
  readonly structured?: Readonly<Record<string, unknown>> | undefined
  readonly amendment?: ParsedAmendment | undefined
}

/** Rótulo histórico de um dispositivo renumerado (`provision_labels`). */
export interface ParsedLabel {
  readonly label: string
  readonly validDuring: ValidityInterval
}

export interface ParsedProvision {
  /** `buildStableKey` (ver `provision-id.ts`); imutável, inclusive em renumerações. */
  readonly stableKey: string
  /** Ex.: "artigo", "paragrafo", "inciso", "alinea", "registro", "campo", "evento", "codigo". */
  readonly kind: string
  readonly parent?: string | undefined
  /** Ordem dentro do documento (ex.: "0076.p06.i02"); só ordena. */
  readonly sortPath: string
  /** Ex.: "RCTE > Livro I > Título III > Capítulo II > Art. 76 > § 6º". */
  readonly headingPath: string
  readonly labels?: readonly ParsedLabel[] | undefined
  readonly versions: readonly ParsedVersion[]
}

/** Redação descartada de propósito (ex.: "Redação sem vigência" = intervalo vazio): só vai ao log. */
export interface SkippedVersion {
  readonly stableKey: string | null
  readonly reason: string
  readonly rawNote: string | null
}

interface ParseStats {
  /** Notas de vigência encontradas (RCTE/CTE: parágrafos `NotaVigncia` e notas inline). */
  readonly notesTotal: number
  /** Notas convertidas em intervalo sem revisão. */
  readonly notesParsed: number
  /** Notas que viraram `review` (o DoD exige `notesParsed + notesToReview = notesTotal`). */
  readonly notesToReview: number
}

export interface ParsedDocumentMeta {
  readonly slug: string
  readonly family: Family
  readonly title: string
  readonly issuer: string
  /** URL https canônica do documento (a página ou o arquivo oficial). */
  readonly sourceUrl: string
}

export interface ParsedDocumentVersion {
  readonly versionLabel: string
  readonly publishedOn: IsoDate
  /**
   * Snapshot (consolidados: `[published_on, próxima consolidação)`) ou período do leiaute. Não é a
   * vigência dos dispositivos.
   */
  readonly validDuring: ValidityInterval
  /** Ex.: "CONSOLIDADO ATÉ O DECRETO Nº 10.986, DE 16.09.26". */
  readonly consolidatedUntil: string | null
  readonly actRef: string | null
  /** sha256 do arquivo-fonte baixado. */
  readonly sha256: string
}

/**
 * Janela que esta versão de documento reescreve: redações atuais (conhecimento aberto) do mesmo
 * documento cujo `valid_during` cruza a janela e que não aparecem nesta versão têm o `knowledge`
 * fechado em `publishedOn`. Consolidados (RCTE, CTE) reescrevem todo o histórico (`{from: null,
 * to: null}`); Guias e leiautes, só o próprio período (`version.validDuring`).
 */
type ReplacementWindow = ValidityInterval

export interface ParsedSource {
  readonly document: ParsedDocumentMeta
  readonly version: ParsedDocumentVersion
  readonly replacementWindow: ReplacementWindow
  readonly provisions: readonly ParsedProvision[]
  readonly skipped: readonly SkippedVersion[]
  readonly stats: ParseStats
}
