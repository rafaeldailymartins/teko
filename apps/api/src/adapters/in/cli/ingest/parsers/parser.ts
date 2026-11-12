import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import type { Family } from '#domain/corpus/family.ts'
import type { ParsedDocumentMeta, ParsedSource } from '#domain/corpus/parsed-source.ts'

/**
 * Contrato dos parsers da ingestão. Cada parser é uma função pura: recebe os bytes de uma versão
 * de documento (e, para PDF/XLSX, a saída do Docling) e devolve um `ParsedSource`. Rede, banco,
 * Blobs e embeddings ficam fora: o pipeline (`ingest.ts`) baixa, chama o parser pelo
 * `parser` da entrada de `corpus/sources.yaml` e entrega o resultado ao `IngestDocumentVersion`.
 */

export const ParserName = {
  /** RCTE e CTE (HTML cp1252, máquina de estados por parágrafo). */
  GoHtmlStateMachine: 'go-html-state-machine',
  /** Guia Prático EFD ICMS/IPI (Docling: registros e tabelas de campos). */
  DoclingGuia: 'docling-guia',
  /** Guia EFD-GO e Notas Técnicas (Docling: tópicos por título). */
  DoclingGeneric: 'docling-generic',
  /** Leiautes da EFD-REINF (XSD do pacote de leiautes, `htmlparser2` em `xmlMode`). */
  ReinfXsd: 'reinf-xsd',
  /** Tabelas de Goiás do WS de Tabelas Externas (TXT cp1252, `|`). */
  SpedTabelas: 'sped-tabelas',
} as const
export type ParserName = (typeof ParserName)[keyof typeof ParserName]

/** Entrada de `corpus/sources.yaml` já resolvida pelo pipeline (datas e janela calculadas). */
export interface SourceDescriptor {
  /** Ex.: `efd-icms-ipi/guia-pratico/3.2.4`, `rcte/consolidado`, `tabelas-go/5-1-1`. */
  readonly id: string
  readonly family: Family
  readonly parser: ParserName
  readonly url: string
  readonly document: ParsedDocumentMeta
  /** `null` quando o próprio conteúdo traz a versão (consolidados, tabelas do WS). */
  readonly versionLabel: string | null
  /** `null` quando o próprio conteúdo traz a data (consolidados, tabelas do WS). */
  readonly publishedOn: IsoDate | null
  /**
   * Vigência da versão de documento: período do leiaute (`leiaute-periods.yaml`, Guia e REINF) ou
   * `[published_on, próxima publicação)` (EFD-GO). `null` nos consolidados e nas tabelas.
   */
  readonly versionValidDuring: ValidityInterval | null
  /** NTs: datas de efeito e do período facultativo/obrigatório. */
  readonly effectiveFrom: IsoDate | null
  readonly optionalFrom: IsoDate | null
  readonly mandatoryFrom: IsoDate | null
  /** Pivô do ano com 2 dígitos (`97` no RCTE, `91` no CTE). */
  readonly yearPivot: number | null
  readonly actRef: string | null
  /**
   * Tabelas de Goiás: linha da tabela no `consultarVersoesTabelasExternas` (o parser monta a versão e
   * confere o SHA-1). `null`/ausente nas demais fontes.
   */
  readonly externalTable?: ExternalTableVersion | null
}

export interface ExternalTableVersion {
  readonly id: number
  readonly versao: number
  readonly desc: string
  readonly dtVersao: IsoDate
  /** SHA-1 (hex) declarado pelo WS. */
  readonly hash: string
}

export interface ParserInput {
  readonly source: SourceDescriptor
  /** sha256 do arquivo baixado (identidade da versão de documento). */
  readonly sha256: string
  /** Arquivo como baixado (HTML, TXT, XSD; para PDF/XLSX, os bytes originais). */
  readonly bytes: Uint8Array
  /**
   * Saída do Docling (`DoclingDocument` JSON) para PDF/XLSX, em partes na ordem das páginas
   * (documentos longos são divididos por `page_range` no job `extract`). Vazio nos demais.
   */
  readonly docling: readonly unknown[]
  /** Membros de um pacote `.zip` (ex.: leiautes da REINF), por caminho interno. Vazio se não for zip. */
  readonly members: ReadonlyMap<string, Uint8Array>
}

export type Parser = (input: ParserInput) => ParsedSource

export class ParseError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'ParseError'
  }
}
