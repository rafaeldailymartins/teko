import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  serial,
  snakeCase,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { datemultirange, daterange, tsvector } from './types.ts'

/**
 * Schema `corpus`: documentos, versões, dispositivos, redações e chunks com vigência. É escrito
 * só pela ingestão e pelo `promote-corpus` (owner); o runtime (`teko_app`) só lê, e o
 * `teko_watch` só atualiza `coverage.verified_at`, `gaps` e `gap_reason`.
 *
 * Colunas com nome em camelCase viram snake_case (`snakeCase.schema`). Tudo que o Drizzle não
 * expressa (extensões, `immutable_unaccent`, EXCLUDE, grants) fica nas migrações custom.
 */
export const corpus = snakeCase.schema('corpus')

/** Dimensão do BGE-M3 (Workers AI `@cf/baai/bge-m3`; spike F1 (f)). */
export const EMBEDDING_DIMENSIONS = 1024

const id = () => uuid().primaryKey().default(sql`uuidv7()`)
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow()

export const ingestionRuns = corpus.table(
  'ingestion_runs',
  {
    id: id(),
    target: text().notNull(),
    gitSha: text().notNull(),
    status: text().notNull(),
    docs: integer().notNull().default(0),
    chunksNew: integer().notNull().default(0),
    neuronsEst: integer().notNull().default(0),
    /** Custo real dos embeddings do run (soma do `onUsage`), contado contra o `EMBED_NEURON_BUDGET`. */
    neurons: integer().notNull().default(0),
    cuSeconds: numeric({ precision: 12, scale: 3 }),
    dbBytes: bigint({ mode: 'number' }),
    report: jsonb(),
    startedAt: createdAt(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      'ingestion_runs_status',
      sql`${t.status} IN ('running', 'succeeded', 'failed', 'budget_exhausted')`,
    ),
    check('ingestion_runs_target', sql`${t.target} IN ('staging', 'production', 'fixture')`),
  ],
)

export const documents = corpus.table(
  'documents',
  {
    id: id(),
    slug: text().notNull().unique(),
    family: text().notNull(),
    jurisdiction: text().notNull(),
    title: text().notNull(),
    issuer: text().notNull(),
    sourceUrl: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('documents_jurisdiction', sql`${t.jurisdiction} IN ('BR', 'GO')`)],
)

export const documentVersions = corpus.table(
  'document_versions',
  {
    id: id(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id),
    versionLabel: text().notNull(),
    publishedOn: date({ mode: 'string' }).notNull(),
    /** Snapshot (consolidados) ou período do leiaute; nunca a vigência do dispositivo. */
    validDuring: daterange().notNull(),
    consolidatedUntil: text(),
    actRef: text(),
    sha256: text().notNull().unique(),
    blobRaw: text(),
    blobDocling: text(),
    status: text().notNull().default('ingesting'),
    /**
     * Revisão do parser que produziu a versão (`PARSER_REVISIONS`). Um sha256 publicado com revisão
     * menor que a atual é reprocessado no próximo run (ADR 0026); 1 para o que já estava gravado.
     */
    parserRevision: integer().notNull().default(1),
    ingestionRunId: uuid().references(() => ingestionRuns.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'document_versions_status',
      sql`${t.status} IN ('ingesting', 'published', 'superseded', 'failed')`,
    ),
    index('document_versions_document').on(t.documentId),
  ],
)

export const provisions = corpus.table(
  'provisions',
  {
    id: id(),
    stableKey: text().notNull().unique(),
    documentId: uuid()
      .notNull()
      .references(() => documents.id),
    kind: text().notNull(),
    parentId: uuid().references((): AnyPgColumn => provisions.id),
    sortPath: text().notNull(),
  },
  (t) => [
    index('provisions_stable_key_trgm').using('gin', t.stableKey.op('gin_trgm_ops')),
    index('provisions_document').on(t.documentId),
  ],
)

/** Rótulos históricos (renumerações): a chave fica, o rótulo exibido muda com a data. */
export const provisionLabels = corpus.table(
  'provision_labels',
  {
    id: id(),
    provisionId: uuid()
      .notNull()
      .references(() => provisions.id),
    label: text().notNull(),
    validDuring: daterange().notNull(),
  },
  (t) => [index('provision_labels_provision').on(t.provisionId)],
)

export const amendments = corpus.table('amendments', {
  id: id(),
  actLabel: text().notNull(),
  actKind: text().notNull(),
  actDate: date({ mode: 'string' }).notNull(),
  effective: daterange().notNull(),
  changeKind: text().notNull(),
  rawNote: text().notNull(),
})

export const provisionVersions = corpus.table(
  'provision_versions',
  {
    id: id(),
    provisionId: uuid()
      .notNull()
      .references(() => provisions.id),
    displayLabel: text().notNull(),
    validDuring: daterange().notNull(),
    /** Tempo de conhecimento (bitemporal): fecha quando uma versão corretiva substitui a linha. */
    knowledge: daterange().notNull(),
    modality: text().notNull().default('mandatory'),
    validityBasis: text().notNull(),
    retroactive: boolean().notNull().default(false),
    reviewStatus: text().notNull().default('auto'),
    text: text().notNull(),
    structured: jsonb(),
    amendmentId: uuid().references(() => amendments.id),
    contentHash: text().notNull(),
  },
  (t) => [
    check('provision_versions_modality', sql`${t.modality} IN ('optional', 'mandatory')`),
    check(
      'provision_versions_review_status',
      sql`${t.reviewStatus} IN ('auto', 'approved', 'pending', 'rejected')`,
    ),
    check(
      'provision_versions_validity_basis',
      sql`${t.validityBasis} IN ('legal_effect', 'leiaute_period', 'publication_approx', 'table_declared')`,
    ),
    check(
      'provision_versions_valid_during',
      sql`NOT isempty(${t.validDuring}) AND NOT lower_inf(${t.validDuring})`,
    ),
    check('provision_versions_knowledge', sql`NOT isempty(${t.knowledge})`),
    index('provision_versions_provision').on(t.provisionId),
  ],
)

export const chunks = corpus.table(
  'chunks',
  {
    id: id(),
    provisionVersionId: uuid()
      .notNull()
      .references(() => provisionVersions.id),
    ordinal: integer().notNull(),
    family: text().notNull(),
    jurisdiction: text().notNull(),
    citationLabel: text().notNull(),
    headingPath: text().notNull(),
    content: text().notNull(),
    contentHash: text().notNull(),
    // Desnormalizadas de provision_versions: o filtro de vigência e status fica no mesmo WHERE
    // do ANN, para o iterative scan do HNSW funcionar.
    validDuring: daterange().notNull(),
    knowledge: daterange().notNull(),
    modality: text().notNull(),
    reviewStatus: text().notNull(),
    corpusVersion: integer().notNull(),
    tsv: tsvector()
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('pg_catalog.portuguese', public.immutable_unaccent(coalesce(${chunks.headingPath}, ''))), 'A') || setweight(to_tsvector('pg_catalog.portuguese', public.immutable_unaccent(${chunks.content})), 'B')`,
      ),
    embedding: halfvec({ dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text(),
  },
  (t) => [
    unique('chunks_provision_version_ordinal').on(t.provisionVersionId, t.ordinal),
    // Parciais: a busca só lê conhecimento aberto (`upper_inf(c.knowledge)` no mesmo WHERE), e o
    // vetor de um chunk fechado é apagado (embedding NULL). Os vetores são ~70% do banco.
    index('chunks_tsv_gin').using('gin', t.tsv).where(sql`upper_inf(${t.knowledge})`),
    index('chunks_embedding_hnsw')
      .using('hnsw', t.embedding.op('halfvec_cosine_ops'))
      .with({ m: 16, ef_construction: 128 })
      .where(sql`upper_inf(${t.knowledge})`),
    index('chunks_family_valid_during_gist').using('gist', t.family, t.validDuring),
    check(
      'chunks_valid_during',
      sql`NOT isempty(${t.validDuring}) AND NOT lower_inf(${t.validDuring})`,
    ),
    check('chunks_jurisdiction', sql`${t.jurisdiction} IN ('BR', 'GO')`),
  ],
)

/** Todas as versões de documento que contêm o chunk (a citação escolhe uma delas). */
export const chunkSources = corpus.table(
  'chunk_sources',
  {
    chunkId: uuid()
      .notNull()
      .references(() => chunks.id, { onDelete: 'cascade' }),
    documentVersionId: uuid()
      .notNull()
      .references(() => documentVersions.id),
  },
  (t) => [
    primaryKey({ columns: [t.chunkId, t.documentVersionId] }),
    index('chunk_sources_document_version').on(t.documentVersionId),
  ],
)

/** Checkpoint dos embeddings da ingestão (cada lote é commitado). */
export const embeddingCache = corpus.table(
  'embedding_cache',
  {
    contentHash: text().notNull(),
    model: text().notNull(),
    embedding: halfvec({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.model] })],
)

/** A versão atual do corpus é `max(id)`. */
export const corpusVersions = corpus.table('corpus_versions', {
  id: serial().primaryKey(),
  runId: uuid().references(() => ingestionRuns.id),
  notes: text(),
  createdAt: createdAt(),
})

/**
 * Cobertura por família, mantida pelo `RefreshCoverage`. A efetiva é
 * `covered * datemultirange(daterange(NULL, verified_at + 1)) - gaps`.
 */
export const coverage = corpus.table(
  'coverage',
  {
    family: text().primaryKey(),
    jurisdiction: text().notNull(),
    covered: datemultirange().notNull(),
    verifiedAt: date({ mode: 'string' }).notNull(),
    corpusVersion: integer().notNull(),
    gaps: datemultirange().notNull().default(sql`'{}'::datemultirange`),
    gapReason: text(),
    /**
     * Lacunas por entrada (`CoverageGapEntry`: documentos que a resolvem, vigência, detecção e
     * motivo). `gaps` e `gap_reason` são sempre a soma delas; a ingestão e a promoção decidem por
     * entrada (lacuna detectada depois do snapshot fica na produção).
     */
    gapEntries: jsonb().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [check('coverage_jurisdiction', sql`${t.jurisdiction} IN ('BR', 'GO')`)],
)

/**
 * Anomalias de vigência à espera de revisão manual. A chave `(stable_key, note_hash)` é a mesma dos
 * `corpus/overrides/*.yaml`: um item aberto por anomalia, mesmo que a fonte seja reingerida.
 */
export const reviewQueue = corpus.table(
  'review_queue',
  {
    id: id(),
    runId: uuid().references(() => ingestionRuns.id),
    provisionId: uuid().references(() => provisions.id),
    reason: text().notNull(),
    rawNote: text(),
    proposed: daterange(),
    status: text().notNull().default('open'),
    createdAt: createdAt(),
    /** Redação `pending` que gerou o item. */
    provisionVersionId: uuid().references(() => provisionVersions.id),
    /** Versão de documento em que a anomalia apareceu pela primeira vez. */
    documentVersionId: uuid().references(() => documentVersions.id),
    stableKey: text(),
    /** Hash da nota que gerou a dúvida (`reviewNoteHash`), chave dos overrides. */
    noteHash: text(),
  },
  (t) => [
    check('review_queue_status', sql`${t.status} IN ('open', 'resolved', 'dismissed')`),
    uniqueIndex('review_queue_open_note')
      .on(t.stableKey, t.noteHash)
      .where(sql`${t.status} = 'open'`),
  ],
)
