import type { IsoDate } from '@teko/shared/vigencia'
import type { Family } from '#domain/corpus/family.ts'

/**
 * Páginas monitoradas pelo `sources-watch` (`corpus/watch.yaml`) e a leitura dos sinais de versão
 * de cada uma. A leitura do HTML/XML fica num adapter de entrada (`htmlparser2`); o caso de uso
 * `WatchSources` só compara os sinais com o estado guardado.
 *
 * Tipos de página (`kind`):
 * - `consolidated`: texto consolidado (`RCTE.htm`, `CTE.htm`); o sinal barato é o cabeçalho
 *   "CONSOLIDADO ATÉ O DECRETO Nº …" (ou "ATUALIZADO ATÉ A LEI Nº …" no CTE).
 * - `act-list`: lista de atos (`Decretos_Atualizadores.htm`, `leis_atualizadoras.htm` e o sumário
 *   anual "Decretos de <ano>"); cada ato novo fica pendente até o consolidado da família alcançá-lo.
 * - `document-index`: índice de documentos (páginas do SPED e do Guia EFD-GO); o sinal é a lista de
 *   links de PDF/XLSX/ZIP que casam com os padrões da página.
 * - `tables-ws`: WS de Tabelas Externas do SPED; o sinal é `versao`/`hash` de cada tabela.
 */

export const WatchKind = {
  Consolidated: 'consolidated',
  ActList: 'act-list',
  DocumentIndex: 'document-index',
  TablesWs: 'tables-ws',
} as const
export type WatchKind = (typeof WatchKind)[keyof typeof WatchKind]

/**
 * `live`: mudança dispara o `ingest.yml` (staging). `pinned`: só registra a mudança e marca a
 * lacuna de cobertura; a fonte fixada no `corpus/sources.yaml` muda por PR.
 */
export const WatchMode = {
  Live: 'live',
  Pinned: 'pinned',
} as const
export type WatchMode = (typeof WatchMode)[keyof typeof WatchMode]

type WatchEncoding = 'utf-8' | 'windows-1252'

interface WatchPageBase {
  /** Identificador estável (chave do estado em `watch-state.json`). */
  readonly id: string
  readonly family: Family
  /** URL `https`; `{yyyy}` é trocado pelo ano do run (em `America/Sao_Paulo`). */
  readonly url: string
  readonly mode: WatchMode
  readonly encoding: WatchEncoding
}

interface ConsolidatedPage extends WatchPageBase {
  readonly kind: typeof WatchKind.Consolidated
}

export interface ActListPage extends WatchPageBase {
  readonly kind: typeof WatchKind.ActList
  /** Espécie dos atos listados. */
  readonly act: 'decreto' | 'lei'
  /** Só atos cuja ementa casa com este regex (case-insensitive) contam. */
  readonly include: string | null
  /** Atos cuja ementa casa com este regex (case-insensitive) são ignorados. */
  readonly exclude: string | null
}

interface DocumentPattern {
  /** Regex (case-insensitive) aplicado à URL absoluta do link. */
  readonly pattern: string
  /** Regex aplicado ao nome do arquivo; os grupos capturados, unidos por `.`, viram o rótulo. */
  readonly versionPattern: string | null
}

export interface DocumentIndexPage extends WatchPageBase {
  readonly kind: typeof WatchKind.DocumentIndex
  readonly documents: readonly DocumentPattern[]
}

export interface TablesWsPage extends WatchPageBase {
  readonly kind: typeof WatchKind.TablesWs
  /** `id` das tabelas no `metadadosXml` (GO: 37, 38, 39 e 40). */
  readonly tableIds: readonly number[]
}

export type WatchPage = ConsolidatedPage | ActListPage | DocumentIndexPage | TablesWsPage

/** Um item observado numa página: ato, documento ou tabela. */
export interface WatchedItem {
  /** Chave estável do item na página (número do ato, URL normalizada, id da tabela). */
  readonly key: string
  readonly url: string
  readonly versionLabel: string | null
  /** Data de efeito estimada (DOE do ato, `dtVersao` da tabela); `null` se a página não traz. */
  readonly date: IsoDate | null
  /** Muda quando o item muda (ex.: `versao:hash` da tabela). */
  readonly fingerprint: string
  /** Número do ato (`10.986` → 10986), para comparar com o consolidado. */
  readonly actNumber: number | null
}

export interface PageSignals {
  /** Rótulo da versão do consolidado (ex.: `Decreto nº 10.986`); `null` nos demais tipos. */
  readonly label: string | null
  readonly labelDate: IsoDate | null
  readonly labelNumber: number | null
  readonly items: readonly WatchedItem[]
}

export interface FetchedPage {
  /** URL final, depois dos redirects (base dos links relativos). */
  readonly url: string
  readonly body: Uint8Array
}

/** Extrai os sinais de versão do corpo de uma página (adapter: `htmlparser2`). */
export interface WatchSignalReader {
  read(page: WatchPage, fetched: FetchedPage): PageSignals
}

export class WatchSignalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WatchSignalError'
  }
}
