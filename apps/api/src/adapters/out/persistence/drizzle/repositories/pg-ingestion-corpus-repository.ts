import { fromPostgresRange, toPostgresRange, type ValidityInterval } from '@teko/shared/vigencia'
import { eq, sql } from 'drizzle-orm'
import {
  type CorpusIngestionRepository,
  DocumentVersionStatus,
  type IngestionUnitOfWork,
  type OpenProvisionVersion,
  UNVERSIONED_CORPUS,
} from '#app/ports/corpus-ingestion-repository.ts'
import { clearResolvedGaps } from '#domain/corpus/coverage-gaps.ts'
import {
  type Family,
  isFamily,
  jurisdictionOf,
  type Modality,
  type ReviewStatus,
} from '#domain/corpus/family.ts'
import type { DrizzleDb } from '../client.ts'
import {
  amendments,
  chunks,
  corpusVersions,
  documents,
  documentVersions,
  provisions,
  provisionVersions,
  reviewQueue,
} from '../schema/corpus.ts'
import { CorpusInvariantError } from './corpus-invariant-error.ts'
import { gapColumns, storedGapEntries } from './coverage-gap-entries.ts'
import { groupByLevel } from './pg-ingestion-provision-levels.ts'

/**
 * `CorpusIngestionRepository` sobre o Drizzle (owner, conexão direta). Uma unidade de trabalho é uma
 * transação; as linhas novas vão em lotes de 500, com IDs `uuidv7()` pedidos ao banco antes, e as
 * operações de reconciliação (fechar, recortar, alargar) são SQL sobre as linhas travadas por
 * `lockOpenVersions`. É também o caminho do seed da fixture (`SeedFixtureCorpus`).
 */

const BATCH_SIZE = 500

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]
type Executor = DrizzleDb | Tx

async function insertInBatches<T>(rows: readonly T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insert(rows.slice(start, start + BATCH_SIZE))
  }
}

async function newIds(tx: Tx, n: number): Promise<string[]> {
  if (n === 0) {
    return []
  }
  const result = await tx.execute<{ id: string }>(
    sql`SELECT uuidv7()::text AS id FROM generate_series(1, ${n}::int)`,
  )
  return result.rows.map((row) => row.id)
}

function take<T>(values: readonly T[], index: number, what: string): T {
  const value = values[index]
  if (value === undefined) {
    throw new CorpusInvariantError(`faltou ${what} na posição ${String(index)}`)
  }
  return value
}

const range = (interval: ValidityInterval) => sql`${toPostgresRange(interval)}::daterange`
const uuidArray = (ids: readonly string[]) => sql`${sql.param([...ids])}::uuid[]`

interface OpenVersionRow {
  readonly id: string
  readonly stable_key: string
  readonly modality: Modality
  readonly review_status: ReviewStatus
  readonly content_hash: string
  readonly valid_during: string
}

function toOpenVersion(row: OpenVersionRow): OpenProvisionVersion {
  return {
    id: row.id,
    stableKey: row.stable_key,
    modality: row.modality,
    reviewStatus: row.review_status,
    contentHash: row.content_hash,
    validDuring: parseRange(row.valid_during),
  }
}

/** `daterange` vindo como texto (`[2020-01-01,)`) no formato do domínio. */
function parseRange(text: string): ValidityInterval {
  const interval = fromPostgresRange(text)
  if (interval === null) {
    throw new CorpusInvariantError(`daterange vazio vindo do banco: ${text}`)
  }
  return interval
}

async function openVersions(
  executor: Executor,
  where: ReturnType<typeof sql>,
  lock: boolean,
): Promise<OpenProvisionVersion[]> {
  const result = await executor.execute<OpenVersionRow>(sql`
    SELECT pv.id, p.stable_key, pv.modality, pv.review_status, pv.content_hash,
           pv.valid_during::text AS valid_during
    FROM corpus.provision_versions pv
    JOIN corpus.provisions p ON p.id = pv.provision_id
    JOIN corpus.documents d ON d.id = p.document_id
    WHERE ${where} AND upper_inf(pv.knowledge)
    ORDER BY p.stable_key, lower(pv.valid_during), pv.id
    ${lock ? sql`FOR UPDATE OF pv` : sql``}`)
  return result.rows.map(toOpenVersion)
}

function unitOfWork(tx: Tx): IngestionUnitOfWork {
  return {
    async upsertDocument(document) {
      const values = {
        slug: document.slug,
        family: document.family,
        jurisdiction: document.jurisdiction,
        title: document.title,
        issuer: document.issuer,
        sourceUrl: document.sourceUrl,
      }
      const [row] = await tx
        .insert(documents)
        .values(values)
        .onConflictDoUpdate({ target: documents.slug, set: values })
        .returning({ id: documents.id })
      if (row === undefined) {
        throw new CorpusInvariantError(`documento ${document.slug} não gravado`)
      }
      return row.id
    },

    async insertDocumentVersion({
      documentId,
      version,
      runId,
      blobRaw,
      blobDocling,
      parserRevision,
      contentFingerprint,
    }) {
      const values = {
        parserRevision,
        contentFingerprint,
        documentId,
        versionLabel: version.versionLabel,
        publishedOn: version.publishedOn,
        validDuring: version.validDuring,
        consolidatedUntil: version.consolidatedUntil,
        actRef: version.actRef,
        sha256: version.sha256,
        blobRaw,
        blobDocling,
        status: DocumentVersionStatus.Ingesting,
        ingestionRunId: runId,
      }
      const [row] = await tx
        .insert(documentVersions)
        .values(values)
        .onConflictDoUpdate({ target: documentVersions.sha256, set: values })
        .returning({ id: documentVersions.id })
      if (row === undefined) {
        throw new CorpusInvariantError(`versão ${version.sha256} não gravada`)
      }
      return row.id
    },

    async closePreviousDocumentVersions(documentId, documentVersionId, from) {
      const result = await tx.execute<{ id: string }>(sql`
        UPDATE corpus.document_versions SET valid_during = daterange(lower(valid_during), ${from}::date)
        WHERE document_id = ${documentId} AND id <> ${documentVersionId}
          AND upper_inf(valid_during)
          AND (lower_inf(valid_during) OR lower(valid_during) < ${from}::date)
        RETURNING id`)
      return result.rows.length
    },

    async upsertProvisions(documentId, rows) {
      const keys = [
        ...new Set(
          rows.flatMap((row) =>
            row.parentStableKey === null ? [row.stableKey] : [row.stableKey, row.parentStableKey],
          ),
        ),
      ]
      const ids = new Map<string, string>()
      if (keys.length > 0) {
        const existing = await tx.execute<{ id: string; stable_key: string; document_id: string }>(
          sql`SELECT id, stable_key, document_id FROM corpus.provisions
              WHERE stable_key = ANY(${sql.param(keys)}::text[])`,
        )
        for (const row of existing.rows) {
          if (row.document_id !== documentId) {
            throw new CorpusInvariantError(
              `stable_key ${row.stable_key} pertence a outro documento`,
            )
          }
          ids.set(row.stable_key, row.id)
        }
      }
      // Um lote por nível na cadeia de pais: o pai sempre existe antes do comando que insere o filho.
      for (const level of groupByLevel(rows)) {
        await insertInBatches(level, async (batch) => {
          const values = batch.map((row) => {
            const parentId = row.parentStableKey === null ? null : ids.get(row.parentStableKey)
            if (parentId === undefined) {
              throw new CorpusInvariantError(`pai ${String(row.parentStableKey)} ausente`)
            }
            return {
              stableKey: row.stableKey,
              documentId,
              kind: row.kind,
              parentId,
              sortPath: row.sortPath,
            }
          })
          const written = await tx
            .insert(provisions)
            .values(values)
            .onConflictDoUpdate({
              target: provisions.stableKey,
              set: {
                kind: sql`excluded.kind`,
                parentId: sql`excluded.parent_id`,
                sortPath: sql`excluded.sort_path`,
              },
            })
            .returning({ id: provisions.id, stableKey: provisions.stableKey })
          for (const row of written) {
            ids.set(row.stableKey, row.id)
          }
        })
      }
      return ids
    },

    async addProvisionLabels(labels) {
      for (const label of labels) {
        await tx.execute(sql`
          INSERT INTO corpus.provision_labels (provision_id, label, valid_during)
          SELECT ${label.provisionId}::uuid, ${label.label}, ${range(label.validDuring)}
          WHERE NOT EXISTS (SELECT 1 FROM corpus.provision_labels
            WHERE provision_id = ${label.provisionId}::uuid AND label = ${label.label}
              AND valid_during = ${range(label.validDuring)})`)
      }
    },

    lockOpenVersions: (documentId) => openVersions(tx, sql`d.id = ${documentId}`, true),

    async closeKnowledge(ids, at) {
      if (ids.length === 0) {
        return null
      }
      const closed = await tx.execute<{ closed_on: string }>(sql`
        UPDATE corpus.provision_versions
        SET knowledge = daterange(lower(knowledge), greatest(${at}::date, lower(knowledge) + 1))
        WHERE id = ANY(${uuidArray(ids)}) AND upper_inf(knowledge)
        RETURNING upper(knowledge)::text AS closed_on`)
      await tx.execute(sql`
        UPDATE corpus.chunks c SET knowledge = pv.knowledge
        FROM corpus.provision_versions pv
        WHERE c.provision_version_id = pv.id AND pv.id = ANY(${uuidArray(ids)})`)
      return closed.rows.reduce<string | null>(
        (latest, row) => (latest === null || row.closed_on > latest ? row.closed_on : latest),
        null,
      )
    },

    async releaseClosedEmbeddings(ids) {
      if (ids.length === 0) {
        return
      }
      await tx.execute(sql`
        UPDATE corpus.chunks SET embedding = NULL
        WHERE provision_version_id = ANY(${uuidArray(ids)}) AND NOT upper_inf(knowledge)
          AND embedding IS NOT NULL`)
    },

    async insertRemainders(rows) {
      const created = await newIds(tx, rows.length)
      for (const [index, row] of rows.entries()) {
        const id = take(created, index, 'ID de recorte')
        await tx.execute(sql`
          INSERT INTO corpus.provision_versions (id, provision_id, display_label, valid_during,
            knowledge, modality, validity_basis, retroactive, review_status, text, structured,
            amendment_id, content_hash)
          SELECT ${id}::uuid, provision_id, display_label, ${range(row.validDuring)},
            daterange(upper(knowledge), NULL), modality, validity_basis, retroactive, review_status,
            text, structured, amendment_id, content_hash
          FROM corpus.provision_versions WHERE id = ${row.sourceId}::uuid`)
        await tx.execute(sql`
          INSERT INTO corpus.chunks (provision_version_id, ordinal, family, jurisdiction,
            citation_label, heading_path, content, content_hash, valid_during, knowledge, modality,
            review_status, corpus_version, embedding, embedding_model)
          SELECT ${id}::uuid, ordinal, family, jurisdiction, citation_label, heading_path, content,
            content_hash, ${range(row.validDuring)}, daterange(upper(knowledge), NULL), modality,
            review_status, ${UNVERSIONED_CORPUS}, embedding, embedding_model
          FROM corpus.chunks WHERE provision_version_id = ${row.sourceId}::uuid`)
        await tx.execute(sql`
          INSERT INTO corpus.chunk_sources (chunk_id, document_version_id)
          SELECT nc.id, s.document_version_id
          FROM corpus.chunks nc
          JOIN corpus.chunks oc ON oc.provision_version_id = ${row.sourceId}::uuid
            AND oc.ordinal = nc.ordinal
          JOIN corpus.chunk_sources s ON s.chunk_id = oc.id
          WHERE nc.provision_version_id = ${id}::uuid
          ON CONFLICT DO NOTHING`)
      }
      return created
    },

    async widen(rows) {
      for (const row of rows) {
        await tx.execute(sql`UPDATE corpus.provision_versions SET valid_during = ${range(row.validDuring)}
          WHERE id = ${row.id}::uuid`)
        await tx.execute(sql`UPDATE corpus.chunks SET valid_during = ${range(row.validDuring)}
          WHERE provision_version_id = ${row.id}::uuid`)
      }
    },

    async insertVersions(rows, context) {
      const amended = rows.flatMap((row, index) =>
        row.amendment === null ? [] : [{ index, row, amendment: row.amendment }],
      )
      const amendmentIds = await newIds(tx, amended.length)
      const amendmentIdOf = new Map(
        amended.map(({ index }, position) => [
          index,
          take(amendmentIds, position, 'ID de alteração'),
        ]),
      )
      await insertInBatches(
        amended.map(({ index, row, amendment }) => {
          const to = row.validDuring.to
          // `effective` vai da data de efeito até o fim da redação; se a data de efeito não for
          // anterior ao fim (nota incoerente), o início da redação evita um range vazio.
          const from =
            to === null || amendment.effectiveFrom < to
              ? amendment.effectiveFrom
              : row.validDuring.from
          return {
            id: amendmentIdOf.get(index) ?? '',
            actLabel: amendment.actLabel,
            actKind: amendment.actKind,
            actDate: amendment.actDate,
            effective: { from, to },
            changeKind: amendment.changeKind,
            rawNote: amendment.rawNote,
          }
        }),
        (batch) => tx.insert(amendments).values(batch),
      )

      const pvIds = await newIds(tx, rows.length)
      await insertInBatches(
        rows.map((row, index) => ({
          id: take(pvIds, index, 'ID de redação'),
          provisionId: row.provisionId,
          displayLabel: row.displayLabel,
          validDuring: row.validDuring,
          knowledge: row.knowledge,
          modality: row.modality,
          validityBasis: row.validityBasis,
          retroactive: row.retroactive,
          reviewStatus: row.reviewStatus,
          text: row.text,
          structured: row.structured,
          amendmentId: amendmentIdOf.get(index) ?? null,
          contentHash: row.contentHash,
        })),
        (batch) => tx.insert(provisionVersions).values(batch),
      )
      await insertInBatches(
        rows.flatMap((row, index) =>
          row.chunks.map((chunk) => ({
            provisionVersionId: take(pvIds, index, 'ID de redação'),
            ordinal: chunk.ordinal,
            family: context.family,
            jurisdiction: context.jurisdiction,
            citationLabel: row.displayLabel,
            headingPath: row.headingPath,
            content: chunk.content,
            contentHash: chunk.contentHash,
            validDuring: row.validDuring,
            knowledge: row.knowledge,
            modality: row.modality,
            reviewStatus: row.reviewStatus,
            corpusVersion: UNVERSIONED_CORPUS,
            embedding: [...chunk.embedding],
            embeddingModel: context.embeddingModel,
          })),
        ),
        (batch) => tx.insert(chunks).values(batch),
      )
      return pvIds
    },

    async addSources(provisionVersionIds, documentVersionId) {
      if (provisionVersionIds.length === 0) {
        return
      }
      await tx.execute(sql`
        INSERT INTO corpus.chunk_sources (chunk_id, document_version_id)
        SELECT c.id, ${documentVersionId}::uuid FROM corpus.chunks c
        WHERE c.provision_version_id = ANY(${uuidArray(provisionVersionIds)})
        ON CONFLICT DO NOTHING`)
    },

    async enqueueReview(items) {
      let opened = 0
      await insertInBatches(items, async (batch) => {
        const written = await tx
          .insert(reviewQueue)
          .values(
            batch.map((item) => ({
              runId: item.runId,
              provisionId: item.provisionId,
              provisionVersionId: item.provisionVersionId,
              documentVersionId: item.documentVersionId,
              stableKey: item.stableKey,
              noteHash: item.noteHash,
              reason: item.reason,
              rawNote: item.rawNote,
              proposed: item.proposed,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: reviewQueue.id })
        opened += written.length
      })
      return opened
    },

    async markPublished(documentVersionId) {
      await tx
        .update(documentVersions)
        .set({ status: DocumentVersionStatus.Published })
        .where(eq(documentVersions.id, documentVersionId))
    },

    async assertPublishedSources(documentId) {
      const result = await tx.execute<{ orphans: number }>(sql`
        SELECT count(*)::int AS orphans FROM corpus.chunks c
        JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
        JOIN corpus.provisions p ON p.id = pv.provision_id
        WHERE p.document_id = ${documentId}::uuid
          AND upper_inf(c.knowledge) AND c.review_status IN ('auto', 'approved')
          AND NOT EXISTS (
            SELECT 1 FROM corpus.chunk_sources s
            JOIN corpus.document_versions dv ON dv.id = s.document_version_id
            WHERE s.chunk_id = c.id AND dv.status = 'published')`)
      const orphans = result.rows[0]?.orphans ?? 0
      if (orphans > 0) {
        throw new CorpusInvariantError(
          `${String(orphans)} chunk(s) publicável(is) sem fonte publicada`,
        )
      }
    },
  }
}

/**
 * Lacunas da família que continuam abertas: sai só a entrada cujo documento tem uma versão
 * publicada criada depois da detecção (M1: publicar outro documento da família, ou reprocessar uma
 * versão antiga pela revisão do parser, não resolve a lacuna). Vale também para a versão publicada
 * num run anterior que falhou antes do `RefreshCoverage`.
 */
async function remainingGaps(tx: Tx, family: Family) {
  const current = await tx.execute<{
    gaps: string
    gap_reason: string | null
    gap_entries: unknown
  }>(
    sql`SELECT gaps::text AS gaps, gap_reason, gap_entries FROM corpus.coverage
        WHERE family = ${family} FOR UPDATE`,
  )
  const row = current.rows[0]
  const entries =
    row === undefined
      ? []
      : storedGapEntries({
          family,
          gaps: row.gaps,
          gapReason: row.gap_reason,
          gapEntries: row.gap_entries,
        })
  if (entries.length === 0) {
    return []
  }
  const published = await tx.execute<{ slug: string; created_at: string }>(sql`
    SELECT d.slug,
      to_char(max(dv.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM corpus.document_versions dv JOIN corpus.documents d ON d.id = dv.document_id
    WHERE dv.status = 'published' AND d.family = ${family}
    GROUP BY d.slug`)
  return clearResolvedGaps(
    entries,
    published.rows.map((row) => ({ slug: row.slug, createdAt: row.created_at })),
  )
}

function asFamily(value: string): Family {
  if (!isFamily(value)) {
    throw new CorpusInvariantError(`família desconhecida no banco: ${value}`)
  }
  return value
}

export function createPgCorpusIngestionRepository(db: DrizzleDb): CorpusIngestionRepository {
  return {
    async findDocumentVersion(sha256) {
      const [row] = await db
        .select({
          id: documentVersions.id,
          status: documentVersions.status,
          parserRevision: documentVersions.parserRevision,
        })
        .from(documentVersions)
        .where(eq(documentVersions.sha256, sha256))
      if (row === undefined) {
        return null
      }
      const status = Object.values(DocumentVersionStatus).find((value) => value === row.status)
      if (status === undefined) {
        throw new CorpusInvariantError(`status de versão desconhecido: ${row.status}`)
      }
      return { id: row.id, status, parserRevision: row.parserRevision }
    },

    async findPublishedByFingerprint(slug, fingerprint) {
      const result = await db.execute<{ id: string; parser_revision: number }>(sql`
        SELECT dv.id::text AS id, dv.parser_revision FROM corpus.document_versions dv
        JOIN corpus.documents d ON d.id = dv.document_id
        WHERE d.slug = ${slug} AND dv.status = 'published'
          AND dv.content_fingerprint = ${fingerprint}
        ORDER BY dv.created_at DESC LIMIT 1`)
      const row = result.rows[0]
      return row === undefined ? null : { id: row.id, parserRevision: row.parser_revision }
    },

    openVersionsOf: (slug) => openVersions(db, sql`d.slug = ${slug}`, false),

    transaction: (work) => db.transaction((tx) => work(unitOfWork(tx))),

    refreshCoverage: ({ runId, verifiedAt, families, notes }) =>
      db.transaction(async (tx) => {
        const targets =
          families ??
          // As famílias do run e as que têm chunks ainda sem versão do corpus (um run anterior
          // que falhou depois de publicar não recalcula a cobertura).
          (
            await tx.execute<{ family: string }>(sql`
              SELECT DISTINCT d.family FROM corpus.document_versions dv
              JOIN corpus.documents d ON d.id = dv.document_id
              WHERE dv.ingestion_run_id = ${runId}::uuid AND dv.status = 'published'
              UNION
              SELECT DISTINCT c.family FROM corpus.chunks c
              WHERE c.corpus_version = ${UNVERSIONED_CORPUS}
              ORDER BY family`)
          ).rows.map((row) => asFamily(row.family))
        if (targets.length === 0) {
          const current = await tx.execute<{ id: number | null }>(
            sql`SELECT max(id) AS id FROM corpus.corpus_versions`,
          )
          return { corpusVersion: current.rows[0]?.id ?? 0 }
        }
        const [version] = await tx
          .insert(corpusVersions)
          .values({ runId, notes })
          .returning({ id: corpusVersions.id })
        if (version === undefined) {
          throw new CorpusInvariantError('não foi possível abrir a versão do corpus')
        }
        for (const family of targets) {
          const gaps = gapColumns(await remainingGaps(tx, family))
          await tx.execute(sql`
            INSERT INTO corpus.coverage AS cov (family, jurisdiction, covered, verified_at,
              corpus_version, gaps, gap_reason, gap_entries)
            SELECT ${family}, ${jurisdictionOf(family)},
              coalesce((SELECT range_agg(pv.valid_during) FROM corpus.provision_versions pv
                JOIN corpus.provisions p ON p.id = pv.provision_id
                JOIN corpus.documents d ON d.id = p.document_id
                WHERE d.family = ${family} AND upper_inf(pv.knowledge)
                  AND pv.review_status IN ('auto', 'approved')), '{}'::datemultirange),
              ${verifiedAt}::date, ${version.id}, ${gaps.gaps}::datemultirange,
              ${gaps.gapReason}, ${gaps.gapEntries}::jsonb
            ON CONFLICT (family) DO UPDATE SET covered = excluded.covered,
              verified_at = excluded.verified_at, corpus_version = excluded.corpus_version,
              gaps = excluded.gaps, gap_reason = excluded.gap_reason,
              gap_entries = excluded.gap_entries`)
        }
        await tx
          .update(chunks)
          .set({ corpusVersion: version.id })
          .where(eq(chunks.corpusVersion, UNVERSIONED_CORPUS))
        return { corpusVersion: version.id }
      }),

    async documentHealth() {
      const result = await db.execute<{
        slug: string
        family: string
        provisions: number
        chunks: number
        pending: number
        versions: number
      }>(sql`
        WITH versions AS (
          SELECT d.slug, d.family,
            count(DISTINCT pv.provision_id)
              FILTER (WHERE pv.review_status IN ('auto', 'approved'))::int AS provisions,
            count(*) FILTER (WHERE pv.review_status = 'pending')::int AS pending,
            count(*)::int AS versions
          FROM corpus.provision_versions pv
          JOIN corpus.provisions p ON p.id = pv.provision_id
          JOIN corpus.documents d ON d.id = p.document_id
          WHERE upper_inf(pv.knowledge)
          GROUP BY d.slug, d.family
        ), open_chunks AS (
          SELECT d.slug, count(*)::int AS chunks
          FROM corpus.chunks c
          JOIN corpus.provision_versions pv ON pv.id = c.provision_version_id
          JOIN corpus.provisions p ON p.id = pv.provision_id
          JOIN corpus.documents d ON d.id = p.document_id
          WHERE upper_inf(c.knowledge) AND c.review_status IN ('auto', 'approved')
          GROUP BY d.slug
        )
        SELECT v.slug, v.family, v.provisions, coalesce(oc.chunks, 0)::int AS chunks,
          v.pending, v.versions
        FROM versions v LEFT JOIN open_chunks oc ON oc.slug = v.slug
        ORDER BY v.slug`)
      return result.rows.map((row) => ({
        slug: row.slug,
        family: row.family,
        provisions: row.provisions,
        chunks: row.chunks,
        pending: row.pending,
        versions: row.versions,
      }))
    },

    async openReviewQueue() {
      const result = await db.execute<{ family: string; reason: string; open: number }>(sql`
        SELECT d.family, q.reason, count(*)::int AS open
        FROM corpus.review_queue q
        JOIN corpus.provisions p ON p.id = q.provision_id
        JOIN corpus.documents d ON d.id = p.document_id
        WHERE q.status = 'open'
        GROUP BY d.family, q.reason
        ORDER BY d.family, q.reason`)
      return result.rows.map((row) => ({ family: row.family, reason: row.reason, open: row.open }))
    },

    async *openChunkTexts() {
      let after = '00000000-0000-0000-0000-000000000000'
      for (;;) {
        const result = await db.execute<{ id: string; heading_path: string; content: string }>(sql`
          SELECT id::text AS id, heading_path, content FROM corpus.chunks
          WHERE upper_inf(knowledge) AND id > ${after}::uuid
          ORDER BY id LIMIT ${CHUNK_TEXT_PAGE}`)
        const last = result.rows.at(-1)
        if (last === undefined) {
          return
        }
        yield result.rows.map((row) => ({ headingPath: row.heading_path, content: row.content }))
        after = last.id
      }
    },
  }
}

/** Página da leitura dos textos dos chunks abertos (keyset por ID). */
const CHUNK_TEXT_PAGE = 2000
