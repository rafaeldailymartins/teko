import { resolve as resolvePath } from 'node:path'
import { AppEnv, PROVISION_SEARCH_LIMIT } from '@teko/shared/contracts'
import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import {
  createDevSession,
  type DevSession,
  type DevSessionArgs,
} from '#adapters/in/cli/dev-session/dev-session.ts'
import type { FixtureCorpusReader } from '#adapters/in/cli/eval-fixture/eval-fixture.ts'
import type {
  CoverageMarkTarget,
  WatchDatabaseUrl,
} from '#adapters/in/cli/sources-watch/run-coverage-mark.ts'
import type { HttpOptions } from '#adapters/in/http/http-options.ts'
import { createBetterAuthGateway } from '#adapters/out/auth/better-auth.ts'
import { createGithubReleasesBlobStore } from '#adapters/out/blobs/github-releases-blob-store.ts'
import { systemClock } from '#adapters/out/clock/system-clock.ts'
import { sha256ContentHasher } from '#adapters/out/crypto/sha256-content-hasher.ts'
import { createWorkersAiEmbeddingAdapter } from '#adapters/out/embeddings/workers-ai/workers-ai-embedding-adapter.ts'
import {
  createFakeEmbeddingAdapter,
  readEmbeddingFixture,
} from '#adapters/out/fakes/fake-embedding-adapter.ts'
import { createFakeLlmAdapter } from '#adapters/out/fakes/fake-llm-adapter.ts'
import { createInMemoryBlobStore } from '#adapters/out/fakes/in-memory-blob-store.ts'
import { createSafeFetcher } from '#adapters/out/http/safe-fetcher.ts'
import { createLlmChain } from '#adapters/out/llm/ai-sdk-llm.ts'
import { createNeonComputeUsage } from '#adapters/out/neon/neon-compute-usage.ts'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { runMigrations } from '#adapters/out/persistence/drizzle/migrate.ts'
import { createPgCoverageRepository } from '#adapters/out/persistence/drizzle/repositories/pg-coverage-repository.ts'
import { createPgCoverageWatchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-coverage-watch-repository.ts'
import { createPgEmbeddingCache } from '#adapters/out/persistence/drizzle/repositories/pg-embedding-cache.ts'
import { createPgFixtureCorpusReader } from '#adapters/out/persistence/drizzle/repositories/pg-fixture-corpus-reader.ts'
import { createPgFixtureCorpusStore } from '#adapters/out/persistence/drizzle/repositories/pg-fixture-corpus-store.ts'
import { createPgCorpusIngestionRepository } from '#adapters/out/persistence/drizzle/repositories/pg-ingestion-corpus-repository.ts'
import {
  createPgDatabaseUsage,
  createPgVectorIndexMaintenance,
} from '#adapters/out/persistence/drizzle/repositories/pg-ingestion-database.ts'
import { createPgIngestionRunRepository } from '#adapters/out/persistence/drizzle/repositories/pg-ingestion-run-repository.ts'
import { createPgProvisionRepository } from '#adapters/out/persistence/drizzle/repositories/pg-provision-repository.ts'
import { createPgQuestionRepository } from '#adapters/out/persistence/drizzle/repositories/pg-question-repository.ts'
import { createPgRateLimitStore } from '#adapters/out/persistence/drizzle/repositories/pg-rate-limit-store.ts'
import { createPgSearchRepository } from '#adapters/out/persistence/drizzle/repositories/pg-search-repository.ts'
import { snapshotCodec } from '#adapters/out/persistence/drizzle/repositories/pg-snapshot-codec.ts'
import { createPgSnapshotRepository } from '#adapters/out/persistence/drizzle/repositories/pg-snapshot-repository.ts'
import { createPgUserRepository } from '#adapters/out/persistence/drizzle/repositories/pg-user-repository.ts'
import {
  BGE_RERANKER_MODEL,
  createWorkersAiRerankerAdapter,
} from '#adapters/out/reranker/workers-ai/workers-ai-reranker-adapter.ts'
import { createLogger } from '#adapters/out/telemetry/logger.ts'
import { createWorkersAiTranslatorAdapter } from '#adapters/out/translator/workers-ai/workers-ai-translator-adapter.ts'
import type {
  Container,
  IngestionContainer,
  QuestionUseCases,
  RetrievalUseCases,
} from '#app/container.ts'
import type { AuthGateway } from '#app/ports/auth-gateway.ts'
import type { BackgroundTaskFailure, BackgroundTasks } from '#app/ports/background-tasks.ts'
import type { BlobStore } from '#app/ports/blob-store.ts'
import type { Clock } from '#app/ports/clock.ts'
import type { ContentHasher } from '#app/ports/content-hasher.ts'
import type { EmbeddingPort } from '#app/ports/embedding-port.ts'
import type { LlmModel } from '#app/ports/llm-port.ts'
import type { RateLimitStore } from '#app/ports/rate-limit-store.ts'
import type { RerankerPort } from '#app/ports/reranker-port.ts'
import type { SafeFetcher } from '#app/ports/safe-fetcher.ts'
import type { TranslatorPort } from '#app/ports/translator-port.ts'
import type { BatchLimits } from '#app/services/embedding-batches.ts'
import type { Lifecycle } from '#app/services/lifecycle.ts'
import { createLifecycle } from '#app/services/lifecycle.ts'
import {
  createNeuronBudget,
  createNeuronMeter,
  DEFAULT_EMBED_NEURON_BUDGET,
  type NeuronMeter,
  type UsageReport,
} from '#app/services/neuron-budget.ts'
import { createProviderRouter } from '#app/services/provider-router.ts'
import type { StreamBudget } from '#app/services/stream-budget.ts'
import { createStreamBudget } from '#app/services/stream-budget.ts'
import { createAskQuestion } from '#app/use-cases/ask-question.ts'
import {
  createCheckCoverage,
  createCoverageSource,
  createGetCoverage,
} from '#app/use-cases/check-coverage.ts'
import { createEmbedPending } from '#app/use-cases/embed-pending.ts'
import { createEvalAnswer } from '#app/use-cases/eval-answer.ts'
import { createExportSnapshot } from '#app/use-cases/export-snapshot.ts'
import { createFindPeriodVersions } from '#app/use-cases/find-period-versions.ts'
import { createGetHealth } from '#app/use-cases/get-health.ts'
import { createHybridSearch } from '#app/use-cases/hybrid-search.ts'
import {
  createIngestDocumentVersion,
  DEFAULT_BYTES_PER_CHUNK,
  DEFAULT_MAX_DATABASE_BYTES,
} from '#app/use-cases/ingest-document-version.ts'
import { createFinishIngestionRun, createStartIngestionRun } from '#app/use-cases/ingestion-run.ts'
import { createInspectCorpus } from '#app/use-cases/inspect-corpus.ts'
import { createPromoteSnapshot } from '#app/use-cases/promote-snapshot.ts'
import { createProvisionUseCases } from '#app/use-cases/provisions.ts'
import { createPruneEmbeddingCache } from '#app/use-cases/prune-embedding-cache.ts'
import { createQuestionHistory } from '#app/use-cases/question-history.ts'
import { createRefreshCoverage } from '#app/use-cases/refresh-coverage.ts'
import {
  createResolveReferenceDate,
  type ResolveReferenceDate,
} from '#app/use-cases/resolve-reference-date.ts'
import { createRetrieveEvidence } from '#app/use-cases/retrieve-evidence.ts'
import {
  createSeedFixtureCorpus,
  type SeedFixtureCorpus,
} from '#app/use-cases/seed-fixture-corpus.ts'
import { createStreamAnswer } from '#app/use-cases/stream-answer.ts'
import { createUserUseCases, type UserUseCases } from '#app/use-cases/users.ts'
import { PUBLISHABLE_REVIEW_STATUSES, ReviewStatus } from '#domain/corpus/family.ts'
import { type BuildInfo, createBuildInfo } from '#domain/shared/build-info.ts'
import { buildApp } from './build-app.ts'
import { EmbeddingsProvider, type Env, RerankerProvider } from './config/env.ts'
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
/** Candidatos que o reranker reordena antes do corte em `SEARCH_LIMIT` (ADR 0027). */
const RERANK_CANDIDATES = 40
/** Teto do reranker antes de manter a ordem do RRF. */
const RERANK_TIMEOUT_MS = 3000
/** Teto da tradução da pergunta em inglês antes de seguir com a original (ADR 0034). */
const TRANSLATION_TIMEOUT_MS = 2000

/**
 * Tradutor da pergunta em inglês: o `m2m100` da mesma conta do Workers AI, ligado junto com os
 * embeddings dela (ADR 0034). Com o fake da fixture, nada é traduzido.
 */
function createTranslator(env: Env): TranslatorPort | null {
  if (
    env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.WorkersAi &&
    env.CF_ACCOUNT_ID !== undefined &&
    env.CF_AI_TOKEN !== undefined
  ) {
    return createWorkersAiTranslatorAdapter({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_AI_TOKEN,
    })
  }
  return null
}

/** Reranker do `RERANKER_PROVIDER`, ou `null` (o `parseEnv` já exigiu as credenciais). */
export function createReranker(env: Env): RerankerPort | null {
  if (
    env.RERANKER_PROVIDER === RerankerProvider.WorkersAi &&
    env.CF_ACCOUNT_ID !== undefined &&
    env.CF_AI_TOKEN !== undefined
  ) {
    return createWorkersAiRerankerAdapter({
      accountId: env.CF_ACCOUNT_ID,
      apiToken: env.CF_AI_TOKEN,
    })
  }
  return null
}

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
export function createEmbeddings(
  env: Env,
  options: { readonly onUsage?: (usage: UsageReport) => void } = {},
): EmbeddingPort | null {
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
      ...(options.onUsage === undefined ? {} : { onUsage: options.onUsage }),
    })
  }
  return null
}

/**
 * Embeddings da ingestão com medição: o Workers AI informa o custo real pelo `onUsage`; qualquer
 * outro provedor (o fake de fixture) é embrulhado para registrar a chamada sem custo informado, e
 * o `EmbedPending` cobra a estimativa conservadora.
 */
function meteredEmbeddings(env: Env, meter: NeuronMeter): EmbeddingPort | null {
  if (env.EMBEDDINGS_PROVIDER === EmbeddingsProvider.WorkersAi) {
    return createEmbeddings(env, { onUsage: (usage) => meter.record(usage) })
  }
  const inner = createEmbeddings(env)
  return inner === null ? null : withUnreportedUsage(inner, meter)
}

function withUnreportedUsage(inner: EmbeddingPort, meter: NeuronMeter): EmbeddingPort {
  return {
    model: inner.model,
    dimensions: inner.dimensions,
    async embed(texts, options) {
      const vectors = await inner.embed(texts, options)
      meter.record({ neurons: null, texts: texts.length })
      return vectors
    },
  }
}

/** Configuração da ingestão que vem do env (o `config/env.ts` valida; ver relatório da F3). */
export interface IngestionConfig {
  /** URL direta do owner (`NEON_*_MIGRATE_URL`): a ingestão e a promoção escrevem no corpus. */
  readonly databaseUrl: string
  /** `EMBED_NEURON_BUDGET` (padrão 8.000). */
  readonly embedNeuronBudget?: number
  /** Guarda de tamanho (padrão 800 MB). */
  readonly maxDatabaseBytes?: number
  /** Bytes por chunk novo na guarda prospectiva (`INGEST_BYTES_PER_CHUNK`). */
  readonly bytesPerChunk?: number
  /** `NEON_API_KEY_STAGING` e `NEON_STAGING_PROJECT_ID` (opcionais: sem eles, `cu_seconds` nulo). */
  readonly neonApiKey?: string
  readonly neonProjectId?: string
}

/** Peças que vêm de fora (adapters das frentes D e E, ou fakes nos testes). */
export interface IngestionDeps {
  /** GitHub Releases (Actions; ADR 0030) ou o store em memória (testes e execução local). */
  readonly blobStore: BlobStore
  readonly clock?: Clock
  /** Substitui os embeddings do env (testes); recebe o medidor para informar o custo. */
  readonly embeddings?: (meter: NeuronMeter) => EmbeddingPort
  /** `fetch` da API do Neon (testes). */
  readonly fetch?: typeof fetch
  /** Limites dos lotes de embedding (testes; o padrão é o do plano: 50 itens, 48 mil tokens). */
  readonly embeddingBatchLimits?: BatchLimits
}

/** Conexões do pool da ingestão: 2 lotes de embedding em voo e a transação da versão. */
const INGESTION_MAX_CONNECTIONS = 4

export function createIngestionContainer(
  env: Env,
  config: IngestionConfig,
  deps: IngestionDeps,
): IngestionContainer {
  const clock = deps.clock ?? systemClock
  const meter = createNeuronMeter()
  const embeddings = deps.embeddings?.(meter) ?? meteredEmbeddings(env, meter)
  if (embeddings === null) {
    throw new Error('a ingestão exige EMBEDDINGS_PROVIDER configurado')
  }
  const database = createDatabase({
    url: config.databaseUrl,
    applicationName: 'teko-ingest',
    maxConnections: INGESTION_MAX_CONNECTIONS,
  })
  const runs = createPgIngestionRunRepository(database.db)
  const repository = createPgCorpusIngestionRepository(database.db)
  const cache = createPgEmbeddingCache(database.db)
  const databaseUsage = createPgDatabaseUsage(database.db)
  const neuronBudget = createNeuronBudget({
    runs,
    clock,
    daily: config.embedNeuronBudget ?? DEFAULT_EMBED_NEURON_BUDGET,
  })
  const embedPending = createEmbedPending({
    embeddings,
    cache,
    runs,
    budget: neuronBudget,
    meter,
    ...(deps.embeddingBatchLimits === undefined ? {} : { batchLimits: deps.embeddingBatchLimits }),
  })
  const runDeps = {
    runs,
    clock,
    databaseUsage,
    vectorIndex: createPgVectorIndexMaintenance(database.db),
    compute: createNeonComputeUsage({
      apiKey: config.neonApiKey,
      projectId: config.neonProjectId,
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    }),
  }
  const snapshotDeps = {
    snapshots: createPgSnapshotRepository(database.pool),
    codec: snapshotCodec,
    blobs: deps.blobStore,
    clock,
  }
  const startIngestionRun = createStartIngestionRun(runDeps)
  const finishIngestionRun = createFinishIngestionRun(runDeps)
  const ingestDocumentVersion = createIngestDocumentVersion({
    repository,
    cache,
    embedPending,
    embeddingModel: embeddings.model,
    hasher: sha256ContentHasher,
    databaseUsage,
    maxDatabaseBytes: config.maxDatabaseBytes ?? DEFAULT_MAX_DATABASE_BYTES,
    bytesPerChunk: config.bytesPerChunk ?? DEFAULT_BYTES_PER_CHUNK,
  })
  const refreshCoverage = createRefreshCoverage({ repository })
  return {
    neuronBudget,
    embeddingModel: embeddings.model,
    rerankerModel: env.RERANKER_PROVIDER === RerankerProvider.WorkersAi ? BGE_RERANKER_MODEL : null,
    useCases: {
      startIngestionRun,
      finishIngestionRun,
      embedPending,
      ingestDocumentVersion,
      refreshCoverage,
      inspectCorpus: createInspectCorpus({ repository }),
      pruneEmbeddingCache: createPruneEmbeddingCache({
        repository,
        cache,
        hasher: sha256ContentHasher,
        embeddingModel: embeddings.model,
      }),
      exportSnapshot: createExportSnapshot(snapshotDeps),
      promoteSnapshot: createPromoteSnapshot(snapshotDeps),
      seedFixtureCorpus: createSeedFixtureCorpus({
        startIngestionRun,
        ingestDocumentVersion,
        refreshCoverage,
        finishIngestionRun,
        store: createPgFixtureCorpusStore(database.db),
      }),
    },
    close: () => database.close(),
  }
}

/**
 * Seed da fixture única (`cli seed-fixtures` e testes): o container da ingestão sobre a URL do
 * owner, com o store de blobs em memória (o seed não grava raw nem Docling).
 */
export function createFixtureSeeder(
  env: Env,
  ownerUrl: string,
  overrides: { readonly clock?: Clock } = {},
): { readonly seedFixtureCorpus: SeedFixtureCorpus; close(): Promise<void> } {
  const ingestion = createIngestionContainer(
    env,
    { databaseUrl: ownerUrl, embedNeuronBudget: env.EMBED_NEURON_BUDGET },
    {
      blobStore: createInMemoryBlobStore(),
      ...(overrides.clock === undefined ? {} : { clock: overrides.clock }),
    },
  )
  return { seedFixtureCorpus: ingestion.useCases.seedFixtureCorpus, close: ingestion.close }
}

function createRetrieval(
  env: Env,
  database: Database,
  embeddings: EmbeddingPort,
  resolveReferenceDate: ResolveReferenceDate,
  clock: Clock,
): RetrievalUseCases {
  const coverage = createCoverageSource({
    coverageRepository: createPgCoverageRepository(database.db),
    clock,
  })
  const checkCoverage = createCheckCoverage({ coverage })
  const searchRepository = createPgSearchRepository(database.pool)
  const reviewStatuses = reviewStatusesFor(env.APP_ENV)
  const hybridSearch = createHybridSearch({
    embeddings,
    searchRepository,
    reviewStatuses,
    embeddingTimeoutMs: QUESTION_EMBEDDING_TIMEOUT_MS,
    limit: SEARCH_LIMIT,
    reranker: createReranker(env),
    rerankCandidates: RERANK_CANDIDATES,
    rerankTimeoutMs: RERANK_TIMEOUT_MS,
    translator: createTranslator(env),
    translationTimeoutMs: TRANSLATION_TIMEOUT_MS,
  })
  return {
    coverage,
    checkCoverage,
    getCoverage: createGetCoverage({ coverage }),
    hybridSearch,
    provisions: createProvisionUseCases({
      repository: createPgProvisionRepository(database.pool),
      reviewStatuses,
      clock,
      limit: PROVISION_SEARCH_LIMIT,
    }),
    retrieveEvidence: createRetrieveEvidence({
      resolveReferenceDate,
      checkCoverage,
      hybridSearch,
      findPeriodVersions: createFindPeriodVersions({ searchRepository, reviewStatuses }),
      minEvidenceRrf: env.MIN_EVIDENCE_RRF,
    }),
  }
}

/** Peças de E/S da ingestão e do watch (adapters de saída montados só aqui). */
export interface IngestionIo {
  readonly fetcher: SafeFetcher
  readonly blobs: BlobStore
  readonly hasher: ContentHasher
  readonly clock: Clock
}

/**
 * Backend dos artefatos: o GitHub Releases do repositório, com o `GITHUB_TOKEN` do job (ADR 0030).
 * Sem token (só possível sem `BLOB_STORE`; o `parseEnv` exige o token com ele), o store em
 * memória (execução local).
 */
export function createBlobStore(env: Env): BlobStore {
  return env.GITHUB_TOKEN === undefined || env.GITHUB_REPOSITORY === undefined
    ? createInMemoryBlobStore()
    : createGithubReleasesBlobStore({ repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN })
}

/**
 * `SafeFetcher` com a allowlist das fontes e a exceção http das fontes fixadas (ADR 0028), o
 * `BlobStore` de `createBlobStore` e o hash de conteúdo.
 */
export function createIngestionIo(
  env: Env,
  allowedHosts: readonly string[],
  httpHosts: readonly string[] = [],
): IngestionIo {
  return {
    fetcher: createSafeFetcher({ allowedHosts, httpHosts }),
    blobs: createBlobStore(env),
    hasher: sha256ContentHasher,
    clock: systemClock,
  }
}

/** Sessão de 7 dias, a mesma do Better Auth. */
const DEV_SESSION_TTL_S = 604_800

/**
 * `cli seed-dev-session`: usuário com onboarding e sessão direto no banco de `DATABASE_URL`, com
 * o cookie assinado pelo `BETTER_AUTH_SECRET`. Só development e ci.
 */
export function createDevSessionSeeder(
  env: Env,
  clock: Clock = systemClock,
): { seed(args: DevSessionArgs): Promise<DevSession>; close(): Promise<void> } {
  if (env.APP_ENV !== AppEnv.Development && env.APP_ENV !== AppEnv.Ci) {
    throw new Error(
      `seed-dev-session só roda com APP_ENV development ou ci (atual: ${env.APP_ENV})`,
    )
  }
  const { DATABASE_URL: url, BETTER_AUTH_SECRET: secret } = env
  if (url === undefined || secret === undefined) {
    throw new Error('seed-dev-session exige DATABASE_URL e BETTER_AUTH_SECRET')
  }
  const database = createDatabase({ url, applicationName: 'teko-dev-session', maxConnections: 1 })
  return {
    seed: (args) =>
      createDevSession(database.pool, {
        secret,
        cookiePrefix: cookiePrefixFor(env.APP_ENV),
        secure: env.WEB_ORIGIN.startsWith('https://'),
        email: args.email,
        name: args.name,
        termsVersion: env.TERMS_VERSION,
        countryOfResidence: args.country,
        now: clock.now(),
        ttlSeconds: DEV_SESSION_TTL_S,
      }),
    close: () => database.close(),
  }
}

/** Leitor do corpus no formato da fixture (`cli eval-fixture`), sobre `DATABASE_URL`. */
export function createFixtureCorpusReader(
  env: Env,
): FixtureCorpusReader & { close(): Promise<void> } {
  if (env.DATABASE_URL === undefined) {
    throw new Error('eval-fixture exige DATABASE_URL (banco do staging; teko_app basta)')
  }
  const database = createDatabase({
    url: env.DATABASE_URL,
    applicationName: 'teko-eval-fixture',
    maxConnections: 1,
  })
  const reader = createPgFixtureCorpusReader(database.db)
  return {
    readDocuments: (selection) => reader.readDocuments(selection),
    readCoverage: (families) => reader.readCoverage(families),
    close: () => database.close(),
  }
}

/**
 * Alvos do `cli coverage-mark`: um pool de 1 conexão por banco (role `teko_watch`). Não passa pelo
 * `parseEnv`: o environment `corpus-watch` só tem as duas URLs.
 */
export function createCoverageMarkTargets(urls: readonly WatchDatabaseUrl[]): {
  readonly targets: CoverageMarkTarget[]
  close(): Promise<void>
} {
  const databases = urls.map((entry) => ({
    name: entry.name,
    database: createDatabase({ url: entry.url, applicationName: 'teko-watch', maxConnections: 1 }),
  }))
  return {
    targets: databases.map(({ name, database }) => ({
      name,
      repository: createPgCoverageWatchRepository(database.db),
    })),
    close: async () => {
      await Promise.all(databases.map(({ database }) => database.close()))
    },
  }
}

export interface ContainerOverrides {
  readonly clock?: Clock
  /** Embeddings no lugar dos do env (testes de degradação). */
  readonly embeddings?: EmbeddingPort
  /** Modelos da cadeia de LLM no lugar dos do env (testes com espião). */
  readonly llmModels?: readonly LlmModel[]
  /** Recebe falhas e estouros de teto das tarefas pós-resposta (padrão: descarta). */
  readonly onBackgroundFailure?: (failure: BackgroundTaskFailure) => void
  /** `application_name` do pool (`teko-api`; a CLI usa `teko-cli`). */
  readonly applicationName?: string
}

/** Neurons estimados por pergunta (embedding da pergunta e reranker de 40 candidatos). */
const NEURONS_PER_QUESTION = 5
const DAY_MS = 86_400_000

/** Modelos do `LLM_PROVIDER` (o `parseEnv` já exigiu as chaves de cada um). */
function createLlmModels(env: Env): LlmModel[] {
  if (env.LLM_PROVIDER === 'fake') {
    return [createFakeLlmAdapter()]
  }
  if (env.LLM_PROVIDER === undefined || env.GROQ_API_KEY === undefined) {
    return []
  }
  const chain = createLlmChain({
    geminiApiKey: env.GEMINI_API_KEY ?? '',
    groqApiKey: env.GROQ_API_KEY,
    geminiModels: [env.GEMINI_MODEL_PRIMARY, env.GEMINI_MODEL_FALLBACK],
    groqModel: env.GROQ_MODEL,
  })
  return env.LLM_PROVIDER === 'groq' ? chain.filter((model) => model.provider === 'groq') : chain
}

interface QuestionWiring {
  readonly database: Database
  readonly retrieval: RetrievalUseCases
  readonly resolveReferenceDate: ResolveReferenceDate
  readonly models: readonly LlmModel[]
  readonly clock: Clock
  readonly lifecycle: Lifecycle
  readonly backgroundTasks: BackgroundTasks
  readonly streamBudget: StreamBudget
}

function createQuestions(env: Env, wiring: QuestionWiring): QuestionUseCases | null {
  if (wiring.models.length === 0) {
    return null
  }
  const { clock, retrieval } = wiring
  const questions = createPgQuestionRepository(wiring.database.pool)
  const router = createProviderRouter({ models: wiring.models, clock })
  const caps = {
    questionsGlobal: env.QUOTA_QUESTIONS_GLOBAL_DAILY,
    questionsPerUser: env.QUOTA_QUESTIONS_PER_USER_DAILY,
    streamSecondsGlobal: env.QUOTA_STREAM_SECONDS_DAILY,
    neuronsGlobal: env.QUOTA_NEURONS_DAILY,
  }
  const reservation = { streamSeconds: env.STREAM_MAX_SECONDS, neurons: NEURONS_PER_QUESTION }
  const pipeline = {
    retrieveEvidence: retrieval.retrieveEvidence,
    router,
    corpusVersion: async () => (await retrieval.coverage()).corpusVersion,
    nowMs: () => clock.now().getTime(),
  }
  return {
    ask: createAskQuestion({
      questions,
      resolveReferenceDate: wiring.resolveReferenceDate,
      checkCoverage: retrieval.checkCoverage,
      coverage: retrieval.coverage,
      router,
      hasher: sha256ContentHasher,
      clock,
      lifecycle: wiring.lifecycle,
      caps,
      reservation,
      killSwitch: env.LLM_KILL_SWITCH,
    }),
    stream: createStreamAnswer({
      questions,
      pipeline,
      clock,
      streamBudget: wiring.streamBudget,
      lifecycle: wiring.lifecycle,
      backgroundTasks: wiring.backgroundTasks,
      reservation,
      cacheTtlMs: env.ANSWER_CACHE_TTL_DAYS * DAY_MS,
    }),
    history: createQuestionHistory({ questions, clock, caps }),
    evalAnswer: createEvalAnswer({ ...pipeline, timeoutMs: env.STREAM_MAX_SECONDS * 1000 }),
  }
}

function buildInfoOf(env: Env): BuildInfo {
  return createBuildInfo({ version: env.APP_VERSION, gitSha: env.GIT_SHA })
}

/** Prefixo dos cookies: `teko` em produção, `teko-stg` nos demais ambientes. */
function cookiePrefixFor(appEnv: Env['APP_ENV']): string {
  return appEnv === AppEnv.Production ? 'teko' : 'teko-stg'
}

/** Better Auth sobre o banco do runtime; `null` sem `BETTER_AUTH_SECRET`. */
function createAuth(env: Env, database: Database): AuthGateway | null {
  if (env.BETTER_AUTH_SECRET === undefined) {
    return null
  }
  const app = (clientId: string | undefined, clientSecret: string | undefined) =>
    clientId === undefined || clientSecret === undefined ? null : { clientId, clientSecret }
  return createBetterAuthGateway(database.db, {
    secret: env.BETTER_AUTH_SECRET,
    webOrigin: env.WEB_ORIGIN,
    cookiePrefix: cookiePrefixFor(env.APP_ENV),
    github: app(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: app(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  })
}

export function createContainer(env: Env, overrides: ContainerOverrides = {}): Container {
  const clock = overrides.clock ?? systemClock
  const buildInfo = buildInfoOf(env)
  const lifecycle = createLifecycle(clock)
  const platform = createPlatformAdapters(env, {
    onBackgroundFailure: overrides.onBackgroundFailure ?? (() => {}),
  })
  const resolveReferenceDate = createResolveReferenceDate({ clock })
  const embeddings = overrides.embeddings ?? createEmbeddings(env)
  let database: Database | null = null
  let retrieval: RetrievalUseCases | null = null
  let users: UserUseCases | null = null
  let auth: AuthGateway | null = null
  let questions: QuestionUseCases | null = null
  const streamBudget = createStreamBudget(
    platform.invocationDeadline,
    env.STREAM_MAX_SECONDS * 1000,
  )
  if (env.DATABASE_URL !== undefined && embeddings !== null) {
    database = createDatabase({
      url: env.DATABASE_URL,
      applicationName: overrides.applicationName ?? 'teko-api',
      maxConnections: env.DATABASE_MAX_CONNECTIONS,
    })
    platform.attachDatabasePool(database.pool)
    retrieval = createRetrieval(env, database, embeddings, resolveReferenceDate, clock)
    users = createUserUseCases({
      users: createPgUserRepository(database.db),
      clock,
      termsVersion: env.TERMS_VERSION,
    })
    auth = createAuth(env, database)
    questions = createQuestions(env, {
      database,
      retrieval,
      resolveReferenceDate,
      models: overrides.llmModels ?? createLlmModels(env),
      clock,
      lifecycle,
      backgroundTasks: platform.backgroundTasks,
      streamBudget,
    })
  }

  return {
    appEnv: env.APP_ENV,
    buildInfo,
    lifecycle,
    auth,
    backgroundTasks: platform.backgroundTasks,
    clientIp: platform.clientIp,
    rateLimitStore: database === null ? null : createPgRateLimitStore(database.pool),
    geo: platform.geo,
    streamBudget,
    useCases: {
      getHealth: createGetHealth({ buildInfo, appEnv: env.APP_ENV, lifecycle }),
      resolveReferenceDate,
      retrieval,
      users,
      questions,
    },
    close: async () => {
      await database?.close()
    },
  }
}

/** Janela fixa do rate limit da aplicação (plano: 60 s). */
const RATE_LIMIT_WINDOW_MS = 60_000

/**
 * Opções do adapter HTTP. O rate limit da aplicação só é registrado com o store do Postgres (o
 * `rateLimitStore` do container): memória local não limita nada com várias instâncias.
 */
export function createHttpOptions(
  env: Env,
  rateLimitStore: RateLimitStore | null = null,
): HttpOptions {
  const network = platformNetwork(env)
  return {
    trustProxy: network.trustProxy,
    requestIdHeader: network.requestIdHeader,
    eventLoopDelayGuard: network.eventLoopDelayGuard,
    docs: env.APP_ENV !== AppEnv.Production,
    webOrigin: env.WEB_ORIGIN,
    // Rotas `/api/v1/_eval/*`: só na stack descartável de CI.
    evalRoutes: env.APP_ENV === AppEnv.Ci,
    // Plano B (Render): o export do web na mesma origem; relativo ao diretório de trabalho.
    ...(env.WEB_STATIC_DIR === undefined
      ? {}
      : { staticSite: { root: resolvePath(env.WEB_STATIC_DIR) } }),
    ...(rateLimitStore === null
      ? {}
      : {
          rateLimit: {
            store: rateLimitStore,
            max: env.RATE_LIMIT_PER_MINUTE,
            timeWindowMs: RATE_LIMIT_WINDOW_MS,
          },
        }),
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
  const app = await buildApp({
    container,
    http: createHttpOptions(env, container.rateLimitStore),
    logger,
  })
  return { app, container, shutdown: platformShutdown(env) }
}
