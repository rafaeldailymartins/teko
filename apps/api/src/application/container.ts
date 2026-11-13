import type { AppEnv } from '@teko/shared/contracts'
import type { BuildInfo } from '#domain/shared/build-info.ts'
import type { BackgroundTasks } from './ports/background-tasks.ts'
import type { ClientIp } from './ports/client-ip.ts'
import type { Lifecycle } from './services/lifecycle.ts'
import type { NeuronBudget } from './services/neuron-budget.ts'
import type { StreamBudget } from './services/stream-budget.ts'
import type { CheckCoverage } from './use-cases/check-coverage.ts'
import type { EmbedPending } from './use-cases/embed-pending.ts'
import type { ExportSnapshot } from './use-cases/export-snapshot.ts'
import type { GetHealth } from './use-cases/get-health.ts'
import type { HybridSearch } from './use-cases/hybrid-search.ts'
import type { IngestDocumentVersion } from './use-cases/ingest-document-version.ts'
import type { FinishIngestionRun, StartIngestionRun } from './use-cases/ingestion-run.ts'
import type { InspectCorpus } from './use-cases/inspect-corpus.ts'
import type { PromoteSnapshot } from './use-cases/promote-snapshot.ts'
import type { PruneEmbeddingCache } from './use-cases/prune-embedding-cache.ts'
import type { RefreshCoverage } from './use-cases/refresh-coverage.ts'
import type { ResolveReferenceDate } from './use-cases/resolve-reference-date.ts'
import type { RetrieveEvidence } from './use-cases/retrieve-evidence.ts'
import type { WriteCorpus } from './use-cases/write-corpus.ts'

/** Casos de uso que dependem do Postgres (montados só com `DATABASE_URL`). */
export interface RetrievalUseCases {
  readonly checkCoverage: CheckCoverage
  readonly hybridSearch: HybridSearch
  readonly retrieveEvidence: RetrieveEvidence
}

/** Casos de uso expostos aos adapters de entrada (HTTP e CLI). */
interface UseCases {
  readonly getHealth: GetHealth
  readonly resolveReferenceDate: ResolveReferenceDate
  /** `null` sem `DATABASE_URL` (as rotas que a usam chegam na F4). */
  readonly retrieval: RetrievalUseCases | null
  /** Escrita do corpus (seed da fixture; ingestão na F3). Exige a URL do owner. */
  readonly writeCorpus: WriteCorpus | null
}

/**
 * Casos de uso da ingestão (CLI `ingest` e `snapshot`, só no Actions e localmente; URL do owner).
 * Montados por `createIngestionContainer` em `composition-root.ts`.
 */
interface IngestionUseCases {
  readonly startIngestionRun: StartIngestionRun
  readonly finishIngestionRun: FinishIngestionRun
  readonly ingestDocumentVersion: IngestDocumentVersion
  readonly embedPending: EmbedPending
  readonly refreshCoverage: RefreshCoverage
  readonly exportSnapshot: ExportSnapshot
  readonly promoteSnapshot: PromoteSnapshot
  readonly inspectCorpus: InspectCorpus
  readonly pruneEmbeddingCache: PruneEmbeddingCache
}

export interface IngestionContainer {
  readonly useCases: IngestionUseCases
  /** Orçamento diário de neurons (para o relatório do run). */
  readonly neuronBudget: NeuronBudget
  /** Modelo de embedding da ingestão (`chunks.embedding_model`; linhagem do snapshot). */
  readonly embeddingModel: string
  /** Reranker configurado (`RERANKER_PROVIDER`), ou `null`: linhagem do snapshot. */
  readonly rerankerModel: string | null
  /** Fecha o pool do Postgres. */
  close(): Promise<void>
}

/**
 * Container de dependências montado à mão em `composition-root.ts` (`createContainer(env)`).
 * Os adapters de entrada só conhecem este contrato, nunca os adapters de saída.
 */
export interface Container {
  readonly appEnv: AppEnv
  readonly buildInfo: BuildInfo
  readonly useCases: UseCases
  readonly lifecycle: Lifecycle
  /** Trabalho pós-resposta (`waitUntil` na Vercel; promise acompanhada fora dela). */
  readonly backgroundTasks: BackgroundTasks
  /** IP do cliente conforme a plataforma e o caminho (direto ou proxiado). */
  readonly clientIp: ClientIp
  /** Teto de cada stream, descontado o prazo da invocação (F4). */
  readonly streamBudget: StreamBudget
  /** Libera recursos (pool do Postgres, exporters...) depois que o servidor HTTP fechou. */
  close(): Promise<void>
}
