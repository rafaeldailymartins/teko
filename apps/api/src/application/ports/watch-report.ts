import type { IsoDate } from '@teko/shared/vigencia'
import type { Family } from '#domain/corpus/family.ts'
import type { WatchMode } from './watch-signals.ts'

/**
 * `discovered.json`: o que o `sources-watch` encontrou num run. É o contrato entre o job `detect`
 * (environment `staging`, grava no store `corpus-manifests` e no artifact do workflow) e o job
 * `mark-coverage` (environment `corpus-watch`, que só lê o arquivo e escreve em `corpus.coverage`).
 */

export const DiscoveredKind = {
  /** Consolidado com rótulo novo (ex.: "CONSOLIDADO ATÉ O DECRETO Nº 10.991"). */
  Consolidated: 'consolidated',
  /** Ato novo numa lista de atos, ainda não alcançado pelo consolidado da família. */
  Act: 'act',
  /** Documento novo num índice (Guia, NT, leiaute). */
  Document: 'document',
  /** Tabela do WS com `versao`/`hash` novos. */
  Table: 'table',
} as const
export type DiscoveredKind = (typeof DiscoveredKind)[keyof typeof DiscoveredKind]

/**
 * `new`: detectada neste run (dispara o `ingest.yml` se a página for `live`). `pending`: ato já
 * detectado antes e ainda não consolidado; é reapresentado a cada run para a lacuna continuar
 * marcada, mas não dispara nova ingestão.
 */
type DiscoveredStatus = 'new' | 'pending'

export interface DiscoveredChange {
  readonly family: Family
  readonly sourceUrl: string
  /** Início da lacuna: data de efeito detectada (ou a data do run, se a fonte não informa). */
  readonly effectiveFrom: IsoDate
  readonly versionLabel: string | null
  readonly kind: DiscoveredKind
  readonly pageId: string
  readonly mode: WatchMode
  readonly status: DiscoveredStatus
  /**
   * Documentos (slug do `corpus/sources.yaml`) cuja publicação resolve a lacuna (`covers` da página
   * ou do padrão no `corpus/watch.yaml`); ausente ou vazio = qualquer documento da família.
   */
  readonly covers?: readonly string[] | undefined
}

export interface WatchPageError {
  readonly pageId: string
  readonly family: Family
  readonly message: string
}

export interface DiscoveredReport {
  readonly schemaVersion: 1
  /** Data do run em `America/Sao_Paulo`: vira o `verified_at` das famílias verificadas. */
  readonly runDate: IsoDate
  readonly generatedAt: string
  readonly changes: readonly DiscoveredChange[]
  readonly errors: readonly WatchPageError[]
  /** Famílias com alguma página que não pôde ser verificada: o `verified_at` delas não avança. */
  readonly unverifiedFamilies: readonly Family[]
}
