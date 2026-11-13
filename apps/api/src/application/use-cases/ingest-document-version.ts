import {
  containsInterval,
  intervalsEqual,
  mergeIntervals,
  overlaps,
  subtractIntervals,
  type ValidityInterval,
} from '@teko/shared/vigencia'
import { chunkText, embeddingText } from '#domain/corpus/chunker.ts'
import {
  jurisdictionOf,
  type Modality,
  PUBLISHABLE_REVIEW_STATUSES,
  ReviewStatus,
} from '#domain/corpus/family.ts'
import type {
  ParsedProvision,
  ParsedSource,
  ParsedVersion,
  ReviewFlag,
} from '#domain/corpus/parsed-source.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import {
  type CorpusIngestionRepository,
  DocumentVersionStatus,
  type NewProvisionVersionRow,
  type OpenProvisionVersion,
  type ReviewItemRow,
} from '../ports/corpus-ingestion-repository.ts'
import { DatabaseSizeLimitError, type DatabaseUsage } from '../ports/database-usage.ts'
import type { EmbeddingCache } from '../ports/embedding-cache.ts'
import type { EmbedPending } from './embed-pending.ts'

/**
 * `IngestDocumentVersion`: publica uma versão de documento (um arquivo-fonte parseado) de forma
 * incremental, reconciliando com o que já está no banco (plano, "Escrita, Blobs, snapshot e
 * promoção"):
 *
 * 1. sha256 já publicado com revisão do parser igual ou maior → `unchanged`, sem tocar o banco nem
 *    a porta de embeddings; com revisão menor, a mesma versão de documento é reprocessada pelos
 *    passos seguintes (ADR 0026);
 * 2. guarda de tamanho: `pg_database_size` acima do limite aborta o run, e, depois do
 *    planejamento e antes dos embeddings, a projeção `tamanho + chunksNovos × bytesPorChunk`
 *    também (guarda prospectiva);
 * 3. planejamento sem trava (`planReconciliation`) e embeddings só das redações novas, pelo
 *    `EmbedPending` (o `embedding_cache` é o checkpoint, com commit por lote). Orçamento esgotado →
 *    `budget_exhausted`, sem publicar nada da versão;
 * 4. uma transação: documento, versão `ingesting`, dispositivos, rótulos, reconciliação (refeita
 *    sobre as linhas travadas), fontes, fila de revisão, `published` e a invariante de fonte
 *    publicada antes do commit.
 *
 * Reconciliação por dispositivo (`stable_key`), contra as redações de conhecimento aberto, com a
 * janela `W = replacementWindow` (consolidados: tudo; Guias e leiautes: o próprio período):
 * - mesma identidade (hash do conteúdo, modalidade e classe de revisão) e mesmo intervalo →
 *   reaproveita a linha e só acrescenta fontes;
 * - mesma identidade e `T = (E − W) ∪ P` contíguo contendo `E` → alarga a linha (e os chunks) até
 *   `T` (versões consecutivas iguais viram uma linha só);
 * - redação aberta que cruza `W` e não casou → fecha o `knowledge` em `publishedOn`; os trechos de
 *   vigência fora de `W` voltam como linhas novas, com os mesmos chunks e embeddings
 *   (bitemporalidade: o que se sabia da parte não reescrita continua valendo);
 * - o resto é inserido; redações `pending` abrem um item na `review_queue` (chave
 *   `(stable_key, note_hash)`), e como o `pv_no_overlap` ignora `pending`, a anomalia sobreposta não
 *   aborta a publicação.
 */

/** Guarda de tamanho do plano: 800 MB (o limite do Neon Free é 1 GB). */
export const DEFAULT_MAX_DATABASE_BYTES = 800 * 1024 * 1024

/**
 * Bytes por chunk novo na guarda prospectiva: `pg_database_size` dividido pelos chunks do staging
 * medido em 2026-11-12 (≈ 10,6 KB, com vetor, texto, tsvector, fontes e índices).
 */
export const DEFAULT_BYTES_PER_CHUNK = 10_854

interface IngestDocumentVersionCommand {
  readonly runId: string
  readonly source: ParsedSource
  /** Chave no store `corpus-raw`. */
  readonly blobRaw: string | null
  /** Chave no store `corpus-docling`. */
  readonly blobDocling: string | null
  /** Revisão atual do parser da fonte (`PARSER_REVISIONS`, ADR 0026). */
  readonly parserRevision: number
}

type IngestDocumentVersionResult =
  | { readonly status: 'unchanged'; readonly documentVersionId: string }
  | {
      readonly status: 'published'
      readonly documentVersionId: string
      /** A versão já estava publicada com revisão menor do parser e foi reprocessada. */
      readonly reprocessed: boolean
      readonly provisionVersionsNew: number
      readonly provisionVersionsWidened: number
      /** Linhas recriadas com o trecho de vigência que a versão nova não reescreve. */
      readonly provisionVersionsSplit: number
      readonly knowledgeClosed: number
      readonly chunksNew: number
      readonly reviewItems: number
      readonly neurons: number
    }
  | {
      readonly status: 'budget_exhausted'
      readonly neurons: number
      readonly embeddedChunks: number
      readonly pendingChunks: number
    }

export type IngestDocumentVersion = (
  command: IngestDocumentVersionCommand,
) => Promise<IngestDocumentVersionResult>

export interface IngestDocumentVersionDeps {
  readonly repository: CorpusIngestionRepository
  readonly cache: EmbeddingCache
  readonly embedPending: EmbedPending
  /** Modelo gravado em `chunks.embedding_model` e chave do cache. */
  readonly embeddingModel: string
  readonly hasher: ContentHasher
  readonly databaseUsage: DatabaseUsage
  readonly maxDatabaseBytes: number
  /** Bytes por chunk novo na guarda prospectiva ({@link DEFAULT_BYTES_PER_CHUNK}). */
  readonly bytesPerChunk: number
}

export class ReconciliationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReconciliationError'
  }
}

/** Hash da nota de uma anomalia: a chave `(stable_key, note_hash)` da fila e dos overrides. */
export function reviewNoteHash(hasher: ContentHasher, flag: ReviewFlag): string {
  return hasher.hash(flag.rawNote ?? `reason:${flag.reason}`)
}

// ---------------------------------------------------------------------------------------------
// Reconciliação (pura)

/** O que a reconciliação precisa de cada redação parseada. */
interface ReconcilableVersion {
  readonly contentHash: string
  readonly modality: Modality
  readonly reviewStatus: ReviewStatus
  readonly validDuring: ValidityInterval
}

export interface ReconcileInput {
  readonly existing: readonly OpenProvisionVersion[]
  readonly provisions: readonly {
    readonly stableKey: string
    readonly versions: readonly ReconcilableVersion[]
  }[]
  readonly window: ValidityInterval
}

/** Redação parseada, pela chave do dispositivo e a posição em `versions`. */
interface VersionRef {
  readonly stableKey: string
  readonly index: number
}

export interface ReconciliationPlan {
  readonly reuse: readonly (VersionRef & { readonly existingId: string })[]
  readonly widen: readonly (VersionRef & {
    readonly existingId: string
    readonly validDuring: ValidityInterval
  })[]
  readonly close: readonly string[]
  readonly remainders: readonly {
    readonly sourceId: string
    readonly validDuring: ValidityInterval
  }[]
  readonly insert: readonly VersionRef[]
}

/** `auto` e `approved` casam entre si; `pending` e `rejected`, cada um só consigo. */
function reviewClass(status: ReviewStatus): string {
  return PUBLISHABLE_REVIEW_STATUSES.includes(status) ? 'publishable' : status
}

function sameIdentity(existing: OpenProvisionVersion, parsed: ReconcilableVersion): boolean {
  return (
    existing.contentHash === parsed.contentHash &&
    existing.modality === parsed.modality &&
    reviewClass(existing.reviewStatus) === reviewClass(parsed.reviewStatus)
  )
}

/**
 * Intervalo `T = (E − W) ∪ P` se for contíguo e contiver `E` (alargamento), ou `null`. `T` igual a
 * `E` significa que nada muda.
 */
export function widenedInterval(
  existing: ValidityInterval,
  parsed: ValidityInterval,
  window: ValidityInterval,
): ValidityInterval | null {
  const pieces = mergeIntervals([...subtractIntervals([existing], [window]), parsed])
  const [target] = pieces
  if (pieces.length !== 1 || target === undefined || !containsInterval(target, existing)) {
    return null
  }
  return target
}

export function planReconciliation(input: ReconcileInput): ReconciliationPlan {
  const byKey = Map.groupBy(input.existing, (row) => row.stableKey)
  const used = new Set<string>()
  const reuse: (VersionRef & { existingId: string })[] = []
  const widen: (VersionRef & { existingId: string; validDuring: ValidityInterval })[] = []
  const insert: VersionRef[] = []

  for (const provision of input.provisions) {
    const candidates = byKey.get(provision.stableKey) ?? []
    const unmatched: { readonly index: number; readonly version: ReconcilableVersion }[] = []
    for (const [index, version] of provision.versions.entries()) {
      const exact = candidates.find(
        (row) =>
          !used.has(row.id) &&
          sameIdentity(row, version) &&
          intervalsEqual(row.validDuring, version.validDuring),
      )
      if (exact === undefined) {
        unmatched.push({ index, version })
      } else {
        used.add(exact.id)
        reuse.push({ stableKey: provision.stableKey, index, existingId: exact.id })
      }
    }
    for (const { index, version } of unmatched) {
      const ref = { stableKey: provision.stableKey, index }
      const match = candidates
        .filter((row) => !used.has(row.id) && sameIdentity(row, version))
        .map((row) => ({
          row,
          target: widenedInterval(row.validDuring, version.validDuring, input.window),
        }))
        .find((candidate) => candidate.target !== null)
      if (match?.target == null) {
        insert.push(ref)
        continue
      }
      used.add(match.row.id)
      if (intervalsEqual(match.target, match.row.validDuring)) {
        reuse.push({ ...ref, existingId: match.row.id })
      } else {
        widen.push({ ...ref, existingId: match.row.id, validDuring: match.target })
      }
    }
  }

  const close: string[] = []
  const remainders: { sourceId: string; validDuring: ValidityInterval }[] = []
  for (const row of input.existing) {
    if (used.has(row.id) || !overlaps(row.validDuring, input.window)) {
      continue
    }
    close.push(row.id)
    for (const piece of subtractIntervals([row.validDuring], [input.window])) {
      remainders.push({ sourceId: row.id, validDuring: piece })
    }
  }
  return { reuse, widen, close, remainders, insert }
}

// ---------------------------------------------------------------------------------------------
// Preparação (chunks e hashes)

interface PreparedChunk {
  readonly ordinal: number
  readonly content: string
  readonly contentHash: string
  readonly embeddingInput: string
  readonly embeddingHash: string
}

interface PreparedVersion extends ReconcilableVersion {
  readonly parsed: ParsedVersion
  readonly chunks: readonly PreparedChunk[]
}

interface PreparedProvision {
  readonly parsed: ParsedProvision
  readonly stableKey: string
  readonly versions: readonly PreparedVersion[]
}

function prepare(source: ParsedSource, hasher: ContentHasher): PreparedProvision[] {
  return source.provisions.map((provision) => ({
    parsed: provision,
    stableKey: provision.stableKey,
    versions: provision.versions.map((version) => ({
      parsed: version,
      contentHash: hasher.hash(version.text),
      modality: version.modality,
      reviewStatus: version.reviewStatus,
      validDuring: version.validDuring,
      chunks: chunkText(version.text, version.displayLabel).map((piece) => {
        const embeddingInput = embeddingText(provision.headingPath, piece.content)
        return {
          ordinal: piece.ordinal,
          content: piece.content,
          contentHash: hasher.hash(piece.content),
          embeddingInput,
          embeddingHash: hasher.hash(embeddingInput),
        }
      }),
    })),
  }))
}

function resolve(
  provisions: ReadonlyMap<string, PreparedProvision>,
  ref: VersionRef,
): { readonly provision: PreparedProvision; readonly version: PreparedVersion } {
  const provision = provisions.get(ref.stableKey)
  const version = provision?.versions[ref.index]
  if (provision === undefined || version === undefined) {
    throw new ReconciliationError(`redação ${ref.stableKey}#${String(ref.index)} desconhecida`)
  }
  return { provision, version }
}

/** Pais antes dos filhos (profundidade da chave), estável. */
function parentsFirst(provisions: readonly ParsedProvision[]): ParsedProvision[] {
  return [...provisions].sort(
    (a, b) => a.stableKey.split(':').length - b.stableKey.split(':').length,
  )
}

// ---------------------------------------------------------------------------------------------
// Caso de uso

export function createIngestDocumentVersion(
  deps: IngestDocumentVersionDeps,
): IngestDocumentVersion {
  return async ({ runId, source, blobRaw, blobDocling, parserRevision }) => {
    const existing = await deps.repository.findDocumentVersion(source.version.sha256)
    const published = existing?.status === DocumentVersionStatus.Published
    if (published && existing.parserRevision >= parserRevision) {
      return { status: 'unchanged', documentVersionId: existing.id }
    }
    const size = await deps.databaseUsage.sizeBytes()
    if (size > deps.maxDatabaseBytes) {
      throw new DatabaseSizeLimitError(size, deps.maxDatabaseBytes)
    }

    const prepared = prepare(source, deps.hasher)
    const byKey = new Map(prepared.map((provision) => [provision.stableKey, provision]))
    const reconcile = (open: readonly OpenProvisionVersion[]) =>
      planReconciliation({
        existing: open,
        provisions: prepared,
        window: source.replacementWindow,
      })

    const draft = reconcile(await deps.repository.openVersionsOf(source.document.slug))
    const newChunks = (plan: ReconciliationPlan) =>
      plan.insert.flatMap((ref) => resolve(byKey, ref).version.chunks)
    // Guarda prospectiva: antes de embutir (o cache é commitado fora da transação), o tamanho
    // depois da versão, pelos chunks novos ao tamanho médio medido, não pode passar do limite.
    const chunkCount = newChunks(draft).length
    const projected = size + chunkCount * deps.bytesPerChunk
    if (projected > deps.maxDatabaseBytes) {
      throw new DatabaseSizeLimitError(projected, deps.maxDatabaseBytes, {
        currentBytes: size,
        newChunks: chunkCount,
        bytesPerChunk: deps.bytesPerChunk,
      })
    }
    const embedded = await deps.embedPending({
      runId,
      texts: newChunks(draft).map((chunk) => ({
        hash: chunk.embeddingHash,
        text: chunk.embeddingInput,
      })),
    })
    if (embedded.status === 'budget_exhausted') {
      return {
        status: 'budget_exhausted',
        neurons: embedded.neurons,
        embeddedChunks: embedded.embedded,
        pendingChunks: embedded.pending,
      }
    }

    const counts = await deps.repository.transaction(async (uow) => {
      const documentId = await uow.upsertDocument({
        ...source.document,
        jurisdiction: jurisdictionOf(source.document.family),
      })
      const documentVersionId = await uow.insertDocumentVersion({
        documentId,
        version: source.version,
        runId,
        blobRaw,
        blobDocling,
        parserRevision,
      })
      await uow.closePreviousDocumentVersions(
        documentId,
        documentVersionId,
        source.version.validDuring.from ?? source.version.publishedOn,
      )
      const provisionIds = await uow.upsertProvisions(
        documentId,
        parentsFirst(source.provisions).map((provision) => ({
          stableKey: provision.stableKey,
          kind: provision.kind,
          parentStableKey: provision.parent ?? null,
          sortPath: provision.sortPath,
        })),
      )
      const idOf = (stableKey: string): string => {
        const id = provisionIds.get(stableKey)
        if (id === undefined) {
          throw new ReconciliationError(`dispositivo ${stableKey} sem ID depois do upsert`)
        }
        return id
      }
      await uow.addProvisionLabels(
        source.provisions.flatMap((provision) =>
          (provision.labels ?? []).map((label) => ({
            provisionId: idOf(provision.stableKey),
            label: label.label,
            validDuring: label.validDuring,
          })),
        ),
      )

      const plan = reconcile(await uow.lockOpenVersions(documentId))
      const vectors = await deps.cache.getMany(
        newChunks(plan).map((chunk) => chunk.embeddingHash),
        deps.embeddingModel,
      )
      const rows: NewProvisionVersionRow[] = plan.insert.map((ref) => {
        const { provision, version } = resolve(byKey, ref)
        return {
          provisionId: idOf(provision.stableKey),
          headingPath: provision.parsed.headingPath,
          displayLabel: version.parsed.displayLabel,
          validDuring: version.validDuring,
          knowledge: { from: source.version.publishedOn, to: null },
          modality: version.modality,
          validityBasis: version.parsed.validityBasis,
          retroactive: version.parsed.retroactive,
          reviewStatus: version.reviewStatus,
          text: version.parsed.text,
          contentHash: version.contentHash,
          structured: version.parsed.structured ?? null,
          amendment: version.parsed.amendment ?? null,
          chunks: version.chunks.map((chunk) => {
            const embedding = vectors.get(chunk.embeddingHash)
            if (embedding === undefined) {
              throw new ReconciliationError(
                `embedding ausente do cache para ${provision.stableKey} (o banco mudou durante o run?)`,
              )
            }
            return {
              ordinal: chunk.ordinal,
              content: chunk.content,
              contentHash: chunk.contentHash,
              embedding,
            }
          }),
        }
      })

      await uow.closeKnowledge(plan.close, source.version.publishedOn)
      await uow.insertRemainders(plan.remainders)
      await uow.widen(
        plan.widen.map((entry) => ({ id: entry.existingId, validDuring: entry.validDuring })),
      )
      const insertedIds = await uow.insertVersions(rows, {
        family: source.document.family,
        jurisdiction: jurisdictionOf(source.document.family),
        embeddingModel: deps.embeddingModel,
      })
      await uow.addSources(
        [
          ...plan.reuse.map((entry) => entry.existingId),
          ...plan.widen.map((entry) => entry.existingId),
          ...insertedIds,
        ],
        documentVersionId,
      )
      const reviewItems: ReviewItemRow[] = plan.insert.flatMap((ref, position) => {
        const { provision, version } = resolve(byKey, ref)
        const provisionVersionId = insertedIds[position]
        if (version.reviewStatus !== ReviewStatus.Pending || provisionVersionId === undefined) {
          return []
        }
        const flag = version.parsed.review ?? { reason: 'pending', rawNote: null }
        return [
          {
            runId,
            provisionId: idOf(provision.stableKey),
            provisionVersionId,
            documentVersionId,
            stableKey: provision.stableKey,
            noteHash: reviewNoteHash(deps.hasher, flag),
            reason: flag.reason,
            rawNote: flag.rawNote,
            proposed: version.validDuring,
          },
        ]
      })
      const queued = await uow.enqueueReview(reviewItems)
      await uow.markPublished(documentVersionId)
      await uow.assertPublishedSources(documentId)
      return {
        documentVersionId,
        provisionVersionsNew: rows.length,
        provisionVersionsWidened: plan.widen.length,
        provisionVersionsSplit: plan.remainders.length,
        knowledgeClosed: plan.close.length,
        chunksNew: rows.reduce((sum, row) => sum + row.chunks.length, 0),
        reviewItems: queued,
      }
    })
    return { status: 'published', reprocessed: published, ...counts, neurons: embedded.neurons }
  }
}
