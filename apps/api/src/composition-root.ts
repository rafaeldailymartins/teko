import { AppEnv } from '@teko/shared/contracts'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { HttpOptions } from '#adapters/in/http/http-options.ts'
import { systemClock } from '#adapters/out/clock/system-clock.ts'
import { sha256ContentHasher } from '#adapters/out/crypto/sha256-content-hasher.ts'
import { createWorkersAiEmbeddingAdapter } from '#adapters/out/embeddings/workers-ai/workers-ai-embedding-adapter.ts'
import {
  createFakeEmbeddingAdapter,
  readEmbeddingFixture,
} from '#adapters/out/fakes/fake-embedding-adapter.ts'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { runMigrations } from '#adapters/out/persistence/drizzle/migrate.ts'
import { createPgCorpusWriter } from '#adapters/out/persistence/drizzle/repositories/pg-corpus-writer.ts'
import { createPgCoverageRepository } from '#adapters/out/persistence/drizzle/repositories/pg-coverage-repository.ts'
import { createPgSearchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-search-repository.ts'
import { createLogger } from '#adapters/out/telemetry/logger.ts'
import type { Container, RetrievalUseCases } from '#app/container.ts'
import type { BackgroundTaskFailure } from '#app/ports/background-tasks.ts'
import type { Clock } from '#app/ports/clock.ts'
import type { EmbeddingPort } from '#app/ports/embedding-port.ts'
import { createLifecycle } from '#app/services/lifecycle.ts'
import { createStreamBudget } from '#app/services/stream-budget.ts'
import { createCheckCoverage } from '#app/use-cases/check-coverage.ts'
import { createGetHealth } from '#app/use-cases/get-health.ts'
import { createHybridSearch } from '#app/use-cases/hybrid-search.ts'
import {
  createResolveReferenceDate,
  type ResolveReferenceDate,
} from '#app/use-cases/resolve-reference-date.ts'
import { createRetrieveEvidence } from '#app/use-cases/retrieve-evidence.ts'
import { createWriteCorpus, type WriteCorpus } from '#app/use-cases/write-corpus.ts'
import { PUBLISHABLE_REVIEW_STATUSES, ReviewStatus } from '#domain/corpus/family.ts'
import { type BuildInfo, createBuildInfo } from '#domain/shared/build-info.ts'
import { buildApp } from './build-app.ts'
import { EmbeddingsProvider, type Env } from './config/env.ts'
import {
  createPlatformAdapters,
  platformNetwork,
  platformShutdown,
  type ShutdownProfile,
} from './config/platform.ts'

/**
 * Raiz de composição: o único módulo que conhece todas as camadas. A fiação é manual e tipada;
 * os adapters de plataforma vêm de `config/platform.ts` (`RUNTIME_TARGET`), e os de saída
 * (Postgres, embeddings; LLM a partir da F4) entram aqui.
 */

/** Teto do embedding da pergunta antes de degradar para `lexical_only`. */
const QUESTION_EMBEDDING_TIMEOUT_MS = 3000
/** Evidências devolvidas pela busca híbrida. */
const SEARCH_LIMIT = 12

/**
 * Status de revisão buscados: produção só `auto` e `approved`; staging inclui `pending` (anomalias
 * visíveis para revisão).
 */
export function reviewStatusesFor(appEnv: Env['APP_ENV']): readonly ReviewStatus[] {
  return appEnv === AppEnv.Staging
    ? [...PUBLISHABLE_REVIEW_STATUSES, ReviewStatus.Pending]
    : PUBLISHABLE_REVIEW_STATUSES
}

/** Adapter de embeddings do `EMBEDDINGS_PROVIDER` (o `parseEnv` já exigiu o que cada um precisa). */
export function createEmbeddings(env: Env): EmbeddingPort | null {
  if (env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.Fake && env.EMBEDDINGS_FIXTURE_PATH) {
    return createFakeEmbeddingAdapter({
      fixture: readEmbeddingFixture(env.EMBEDDINGS_FIXTURE_PATH),
      hasher: sha256ContentHasher,
      strict: env.EMBEDDINGS_FAKE_STRICT,
    })
  }
  if (
    env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.WorkersAi &&
    env.CF_ACCOUNT_ID !== undefined &&
    env.CF_AI_TOKEN !== undefined
  ) {
    return createWorkersAiEmbeddingAdapter({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_AI_TOKEN,
    })
  }
  return null
}

interface CorpusServices {
  readonly retrieval: RetrievalUseCases
  readonly writeCorpus: WriteCorpus
}

function createCorpusServices(
  env: Env,
  database: Database,
  embeddings: EmbeddingPort,
  resolveReferenceDate: ResolveReferenceDate,
): CorpusServices {
  const checkCoverage = createCheckCoverage({
    coverageRepository: createPgCoverageRepository(database.db),
  })
  const hybridSearch = createHybridSearch({
    embeddings,
    searchRepository: createPgSearchRepository(database.pool),
    reviewStatuses: reviewStatusesFor(env.APP_ENV),
    embeddingTimeoutMs: QUESTION_EMBEDDING_TIMEOUT_MS,
    limit: SEARCH_LIMIT,
  })
  return {
    retrieval: {
      checkCoverage,
      hybridSearch,
      retrieveEvidence: createRetrieveEvidence({
        resolveReferenceDate,
        checkCoverage,
        hybridSearch,
        minEvidenceRrf: env.MIN_EVIDENCE_RRF,
      }),
    },
    writeCorpus: createWriteCorpus({
      writer: createPgCorpusWriter(database.db, { gitSha: env.GIT_SHA }),
      embeddings,
      hasher: sha256ContentHasher,
    }),
  }
}

export interface ContainerOverrides {
  readonly clock?: Clock
  /** Recebe falhas e estouros de teto das tarefas pós-resposta (padrão: descarta). */
  readonly onBackgroundFailure?: (failure: BackgroundTaskFailure) => void
  /** `application_name` do pool (`teko-api`; a CLI usa `teko-cli`). */
  readonly applicationName?: string
}

function buildInfoOf(env: Env): BuildInfo {
  return createBuildInfo({ version: env.APP_VERSION, gitSha: env.GIT_SHA })
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const clock = overrides.clock ?? systemClock
  const buildInfo = buildInfoOf(env)
  const lifecycle = createLifecycle(clock)
  const platform = createPlatformAdapters(env, {
    onBackgroundFailure: overrides.onBackgroundFailure ?? (() => {}),
  })
  const resolveReferenceDate = createResolveReferenceDate({ clock })
  const embeddings = createEmbeddings(env)
  let database: Database | null = null
  let corpus: CorpusServices | null = null
  if (env.DATABASE_URL !== undefined && embeddings !== null) {
    database = createDatabase({
      url: env.DATABASE_URL,
      applicationName: overrides.applicationName ?? 'teko-api',
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
    })
    platform.attachDatabasePool(database.pool)
    corpus = createCorpusServices(env, database, embeddings, resolveReferenceDate)
  }

  return {
    appEnv: env.APP_ENV,
    buildInfo,
    lifecycle,
    backgroundTasks: platform.backgroundTasks,
    clientIp: platform.clientIp,
    streamBudget: createStreamBudget(platform.invocationDeadline),
    useCases: {
      getHealth: createGetHealth({ buildInfo, appEnv: env.APP_ENV, lifecycle }),
      resolveReferenceDate,
      retrieval: corpus?.retrieval ?? null,
      writeCorpus: corpus?.writeCorpus ?? null,
    },
    close: async () => {
      await database?.close()
    },
  }
}

export function createHttpOptions(env: Env): HttpOptions {
  const network = platformNetwork(env)
  return {
    webOrigin: env.WEB_ORIGIN,
    trustProxy: network.trustProxy,
    requestIdHeader: network.requestIdHeader,
    eventLoopDelayGuard: network.eventLoopDelayGuard,
    docs: env.APP_ENV !== AppEnv.Production,
    // Sem `rateLimit`: o `PgRateLimitStore` (tabela `app.rate_limits`) chega com o schema, e
    // nenhuma rota da F1 abre transação. Memória local não serve com várias instâncias.
  }
}

/** Loga falhas de tarefas pós-resposta sem derrubar nada (o erro já foi contido no adapter). */
export function logBackgroundFailure(
  logger: FastifyBaseLogger,
): (failure: BackgroundTaskFailure) => void {
  return ({ name, outcome, error }) => {
    logger.warn({ task: name, outcome, err: error }, 'background task did not complete')
  }
}

/** Aplica as migrações (URL direta do owner). Usado pela CLI (`seed-fixtures --migrate`). */
export function migrateDatabase(ownerUrl: string, migrationsFolder?: string): Promise<void> {
  return runMigrations(ownerUrl, migrationsFolder)
}

export interface Runtime {
  readonly app: FastifyInstance
  readonly container: Container
  readonly shutdown: ShutdownProfile
}

/** Monta logger, container e app a partir de um env já validado (usado por `server.ts`). */
export async function createRuntime(env: Env): Promise<Runtime> {
  const buildInfo = buildInfoOf(env)
  const logger = createLogger({
    level: env.LOG_LEVEL,
    appEnv: env.APP_ENV,
    version: buildInfo.version,
    gitSha: buildInfo.gitSha,
    pretty: env.LOG_PRETTY,
  })
  const container = createContainer(env, { onBackgroundFailure: logBackgroundFailure(logger) })
  const app = await buildApp({ container, http: createHttpOptions(env), logger })
  return { app, container, shutdown: platformShutdown(env) }
}
