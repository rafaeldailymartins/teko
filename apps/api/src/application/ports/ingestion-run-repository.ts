import type { IsoDate } from '@teko/shared/vigencia'

/**
 * Registro dos runs de ingestão (`corpus.ingestion_runs`, URL do owner). Cada run soma o custo real
 * dos embeddings (`neurons`, commit por lote, fora da transação da versão de documento), e é essa
 * soma, por dia de `America/Sao_Paulo`, que o orçamento diário (`EMBED_NEURON_BUDGET`) consulta.
 */

export const IngestionTarget = {
  Staging: 'staging',
  Production: 'production',
  Fixture: 'fixture',
} as const
export type IngestionTarget = (typeof IngestionTarget)[keyof typeof IngestionTarget]

export const IngestionRunStatus = {
  Running: 'running',
  Succeeded: 'succeeded',
  Failed: 'failed',
  BudgetExhausted: 'budget_exhausted',
} as const
export type IngestionRunStatus = (typeof IngestionRunStatus)[keyof typeof IngestionRunStatus]

/** Status final de um run (`running` é só o inicial). */
export type FinishedRunStatus = Exclude<IngestionRunStatus, 'running'>

export interface StartRunRecord {
  readonly target: IngestionTarget
  readonly gitSha: string
  readonly report: Readonly<Record<string, unknown>>
  /** Instante do início pelo `Clock` da aplicação (o dia do orçamento sai dele). */
  readonly startedAt: Date
}

export interface FinishRunRecord {
  readonly runId: string
  readonly status: FinishedRunStatus
  /** Mesclado ao `report` gravado no início (as chaves novas vencem). */
  readonly report: Readonly<Record<string, unknown>>
  readonly cuSeconds: number | null
  readonly dbBytes: number | null
}

interface IngestionRunSummary {
  readonly id: string
  readonly target: IngestionTarget
  readonly status: IngestionRunStatus
  readonly neurons: number
  readonly report: Readonly<Record<string, unknown>>
}

export interface IngestionRunRepository {
  /** Abre o run com `status='running'` e devolve o ID. */
  start(record: StartRunRecord): Promise<string>
  get(runId: string): Promise<IngestionRunSummary | null>
  /** Soma neurons ao run (commit imediato: é parte do checkpoint). */
  addNeurons(runId: string, neurons: number): Promise<void>
  /** Neurons de todos os runs iniciados no dia `day` do fuso `timeZone`. */
  neuronsSpentOn(day: IsoDate, timeZone: string): Promise<number>
  /**
   * Fecha o run: status, report, CU-s e tamanho do banco; `docs` e `chunks_new` são contados no
   * banco (versões de documento publicadas pelo run e chunks novos delas).
   */
  finish(record: FinishRunRecord): Promise<void>
}
