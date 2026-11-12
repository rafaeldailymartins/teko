import { sql } from 'drizzle-orm'
import type { CorpusSnapshot, CorpusWriter, DocumentRecord } from '#app/ports/corpus-writer.ts'
import type { DrizzleDb } from '../client.ts'
import {
  amendments,
  chunkSources,
  chunks,
  corpusVersions,
  coverage,
  documents,
  documentVersions,
  ingestionRuns,
  provisions,
  provisionVersions,
} from '../schema/corpus.ts'
import { groupByLevel } from './pg-ingestion-provision-levels.ts'

/**
 * `CorpusWriter` sobre o Drizzle (URL do owner, conexão direta). Tudo numa transação: uma falha
 * desfaz o lote inteiro, e a nova `corpus_versions` só fica visível no commit.
 *
 * As linhas vão em lotes de `BATCH_SIZE` (como na ingestão do plano). Os IDs `uuidv7()` são pedidos
 * ao banco antes, numa consulta por tabela, para que os filhos já saibam o ID dos pais sem depender
 * da ordem do `RETURNING`.
 */

const BATCH_SIZE = 500

type Tx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0]

export class CorpusInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CorpusInvariantError'
  }
}

async function insertInBatches<T>(rows: readonly T[], insert: (batch: T[]) => Promise<unknown>) {
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    await insert(rows.slice(start, start + BATCH_SIZE))
  }
}

/** `n` IDs `uuidv7()` gerados pelo Postgres, em ordem crescente. */
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

interface WrittenCounts {
  readonly provisionVersions: number
  readonly chunks: number
}

async function writeDocument(
  tx: Tx,
  doc: DocumentRecord,
  context: {
    readonly corpusVersion: number
    readonly runId: string
    readonly embeddingModel: string
  },
): Promise<WrittenCounts> {
  const [documentId = ''] = await newIds(tx, 1)
  await tx.insert(documents).values({
    id: documentId,
    slug: doc.slug,
    family: doc.family,
    jurisdiction: doc.jurisdiction,
    title: doc.title,
    issuer: doc.issuer,
    sourceUrl: doc.sourceUrl,
  })

  const versionIds = await newIds(tx, doc.versions.length)
  const versionIdByKey = new Map(
    doc.versions.map((version, index) => [version.key, take(versionIds, index, 'ID de versão')]),
  )
  await insertInBatches(
    doc.versions.map((version) => ({
      id: versionIdByKey.get(version.key) ?? '',
      documentId,
      versionLabel: version.versionLabel,
      publishedOn: version.publishedOn,
      validDuring: version.validDuring,
      consolidatedUntil: version.consolidatedUntil,
      actRef: version.actRef,
      sha256: version.sha256,
      status: 'published',
      ingestionRunId: context.runId,
    })),
    (batch) => tx.insert(documentVersions).values(batch),
  )

  const ordered = doc.provisions
  const provisionIds = await newIds(tx, ordered.length)
  const provisionIdByKey = new Map(
    ordered.map((provision, index) => [
      provision.stableKey,
      take(provisionIds, index, 'ID de dispositivo'),
    ]),
  )
  const provisionRows = ordered.map((provision) => {
    const parentId =
      provision.parentStableKey === null ? null : provisionIdByKey.get(provision.parentStableKey)
    if (parentId === undefined) {
      throw new CorpusInvariantError(`pai ${String(provision.parentStableKey)} ausente`)
    }
    return {
      id: provisionIdByKey.get(provision.stableKey) ?? '',
      stableKey: provision.stableKey,
      documentId,
      kind: provision.kind,
      parentId,
      sortPath: provision.sortPath,
    }
  })
  // Um lote por nível na cadeia de pais: o pai sempre existe antes do comando que insere o filho.
  const rowByKey = new Map(provisionRows.map((row) => [row.stableKey, row]))
  for (const level of groupByLevel(ordered)) {
    await insertInBatches(
      level.flatMap((provision) => rowByKey.get(provision.stableKey) ?? []),
      (batch) => tx.insert(provisions).values(batch),
    )
  }

  const versions = doc.provisions.flatMap((provision) =>
    provision.versions.map((version) => ({ provision, version })),
  )
  const amended = versions.filter(({ version }) => version.amendment !== null)
  const amendmentIds = await newIds(tx, amended.length)
  const amendmentIdOf = new Map(
    amended.map(({ version }, index) => [version, take(amendmentIds, index, 'ID de alteração')]),
  )
  await insertInBatches(
    amended.map(({ version }) => {
      const amendment = version.amendment
      if (amendment === null) {
        throw new CorpusInvariantError('alteração ausente')
      }
      return {
        id: amendmentIdOf.get(version) ?? '',
        actLabel: amendment.actLabel,
        actKind: amendment.actKind,
        actDate: amendment.actDate,
        effective: { from: amendment.effectiveFrom, to: version.validDuring.to },
        changeKind: amendment.changeKind,
        rawNote: amendment.rawNote,
      }
    }),
    (batch) => tx.insert(amendments).values(batch),
  )

  const pvIds = await newIds(tx, versions.length)
  await insertInBatches(
    versions.map(({ provision, version }, index) => ({
      id: take(pvIds, index, 'ID de redação'),
      provisionId: provisionIdByKey.get(provision.stableKey) ?? '',
      displayLabel: version.displayLabel,
      validDuring: version.validDuring,
      knowledge: version.knowledge,
      modality: version.modality,
      validityBasis: version.validityBasis,
      retroactive: version.retroactive,
      reviewStatus: version.reviewStatus,
      text: version.text,
      structured: version.structured,
      amendmentId: amendmentIdOf.get(version) ?? null,
      contentHash: version.contentHash,
    })),
    (batch) => tx.insert(provisionVersions).values(batch),
  )

  const chunkEntries = versions.flatMap(({ provision, version }, index) =>
    version.chunks.map((chunk) => ({
      provision,
      version,
      chunk,
      pvId: take(pvIds, index, 'ID de redação'),
    })),
  )
  const chunkIds = await newIds(tx, chunkEntries.length)
  await insertInBatches(
    chunkEntries.map(({ provision, version, chunk, pvId }, index) => ({
      id: take(chunkIds, index, 'ID de chunk'),
      provisionVersionId: pvId,
      ordinal: chunk.ordinal,
      family: doc.family,
      jurisdiction: doc.jurisdiction,
      citationLabel: version.displayLabel,
      headingPath: provision.headingPath,
      content: chunk.content,
      contentHash: chunk.contentHash,
      validDuring: version.validDuring,
      knowledge: version.knowledge,
      modality: version.modality,
      reviewStatus: version.reviewStatus,
      corpusVersion: context.corpusVersion,
      embedding: chunk.embedding === null ? null : [...chunk.embedding],
      embeddingModel: chunk.embedding === null ? null : context.embeddingModel,
    })),
    (batch) => tx.insert(chunks).values(batch),
  )

  const sources = chunkEntries.flatMap(({ version }, index) =>
    version.documentVersionKeys.map((key) => {
      const documentVersionId = versionIdByKey.get(key)
      if (documentVersionId === undefined) {
        throw new CorpusInvariantError(`versão de documento ${key} desconhecida em ${doc.slug}`)
      }
      return { chunkId: take(chunkIds, index, 'ID de chunk'), documentVersionId }
    }),
  )
  await insertInBatches(sources, (batch) => tx.insert(chunkSources).values(batch))
  return { provisionVersions: versions.length, chunks: chunkEntries.length }
}

/** Todo chunk com conhecimento atual e status publicável tem ao menos uma fonte publicada. */
async function assertPublishableChunksHaveSources(tx: Tx): Promise<void> {
  const result = await tx.execute<{ orphans: number }>(sql`
    SELECT count(*)::int AS orphans FROM corpus.chunks c
    WHERE upper_inf(c.knowledge) AND c.review_status IN ('auto', 'approved')
      AND NOT EXISTS (
        SELECT 1 FROM corpus.chunk_sources s
        JOIN corpus.document_versions dv ON dv.id = s.document_version_id
        WHERE s.chunk_id = c.id AND dv.status = 'published')`)
  const orphans = result.rows[0]?.orphans ?? 0
  if (orphans > 0) {
    throw new CorpusInvariantError(`${String(orphans)} chunk(s) publicável(is) sem fonte publicada`)
  }
}

export function createPgCorpusWriter(
  db: DrizzleDb,
  options: { readonly gitSha: string },
): CorpusWriter {
  return {
    write: (snapshot: CorpusSnapshot) =>
      db.transaction(async (tx) => {
        if (snapshot.replace) {
          await tx.execute(sql`TRUNCATE corpus.chunk_sources, corpus.chunks, corpus.provision_versions,
            corpus.provision_labels, corpus.amendments, corpus.review_queue, corpus.provisions,
            corpus.document_versions, corpus.documents, corpus.coverage, corpus.corpus_versions,
            corpus.embedding_cache, corpus.ingestion_runs RESTART IDENTITY`)
        }
        const [run] = await tx
          .insert(ingestionRuns)
          .values({ target: 'fixture', gitSha: options.gitSha, status: 'running' })
          .returning({ id: ingestionRuns.id })
        const [version] = await tx
          .insert(corpusVersions)
          .values({ runId: run?.id ?? null, notes: snapshot.notes })
          .returning({ id: corpusVersions.id })
        if (run === undefined || version === undefined) {
          throw new CorpusInvariantError('não foi possível abrir a versão do corpus')
        }
        let provisionVersionTotal = 0
        let chunkTotal = 0
        for (const doc of snapshot.documents) {
          const written = await writeDocument(tx, doc, {
            corpusVersion: version.id,
            runId: run.id,
            embeddingModel: snapshot.embeddingModel,
          })
          provisionVersionTotal += written.provisionVersions
          chunkTotal += written.chunks
        }
        for (const entry of snapshot.coverage) {
          const values = {
            family: entry.family,
            jurisdiction: entry.jurisdiction,
            covered: [...entry.covered],
            verifiedAt: entry.verifiedAt,
            corpusVersion: version.id,
            gaps: [...entry.gaps],
            gapReason: entry.gapReason,
          }
          await tx
            .insert(coverage)
            .values(values)
            .onConflictDoUpdate({ target: coverage.family, set: values })
        }
        await assertPublishableChunksHaveSources(tx)
        await tx
          .update(ingestionRuns)
          .set({
            status: 'succeeded',
            docs: snapshot.documents.length,
            chunksNew: chunkTotal,
            finishedAt: sql`now()`,
          })
          .where(sql`${ingestionRuns.id} = ${run.id}`)
        return {
          corpusVersion: version.id,
          documents: snapshot.documents.length,
          provisionVersions: provisionVersionTotal,
          chunks: chunkTotal,
        }
      }),
  }
}
