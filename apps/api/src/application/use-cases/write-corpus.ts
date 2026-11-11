import type { Jurisdiction } from '@teko/shared/contracts'
import type { IsoDate, ValidityInterval } from '@teko/shared/vigencia'
import { chunkText, embeddingText } from '#domain/corpus/chunker.ts'
import {
  type Family,
  jurisdictionOf,
  type Modality,
  type ReviewStatus,
  type ValidityBasis,
} from '#domain/corpus/family.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import type {
  AmendmentRecord,
  ChunkRecord,
  CorpusWriteResult,
  CorpusWriter,
  DocumentRecord,
  DocumentVersionRecord,
  ProvisionVersionRecord,
} from '../ports/corpus-writer.ts'
import type { EmbeddingPort } from '../ports/embedding-port.ts'
import { planEmbeddingBatches } from '../services/embedding-batches.ts'

/**
 * `WriteCorpus`: transforma documentos com redações em linhas do schema `corpus` (hash do conteúdo,
 * chunks, embeddings) e grava tudo numa transação, com a cobertura e um novo `corpus_versions`.
 * Na F2 é a entrada do `seed-fixtures`; a ingestão da F3 reaproveita o mesmo caminho por versão de
 * documento.
 *
 * Os embeddings vêm da porta (o fake de fixture em testes e evals), em lotes planejados por
 * `planEmbeddingBatches` (itens e tokens), com o mesmo texto embutido uma vez só.
 */

interface SourceProvisionVersion {
  readonly displayLabel: string
  readonly validDuring: ValidityInterval
  readonly knowledge?: ValidityInterval | undefined
  readonly modality: Modality
  readonly validityBasis: ValidityBasis
  readonly retroactive: boolean
  readonly reviewStatus: ReviewStatus
  readonly text: string
  readonly structured?: Readonly<Record<string, unknown>> | undefined
  readonly amendment?: AmendmentRecord | undefined
  readonly documentVersions: readonly string[]
}

interface SourceProvision {
  readonly stableKey: string
  readonly kind: string
  readonly parent?: string | undefined
  readonly sortPath: string
  readonly headingPath: string
  readonly versions: readonly SourceProvisionVersion[]
}

export interface SourceDocument {
  readonly slug: string
  readonly family: Family
  readonly title: string
  readonly issuer: string
  readonly sourceUrl: string
  readonly versions: readonly DocumentVersionRecord[]
  readonly provisions: readonly SourceProvision[]
}

interface SourceCoverage {
  readonly family: Family
  readonly covered: readonly ValidityInterval[]
  readonly verifiedAt: IsoDate
  readonly gaps: readonly { readonly interval: ValidityInterval; readonly reason: string }[]
}

export interface WriteCorpusCommand {
  readonly documents: readonly SourceDocument[]
  readonly coverage: readonly SourceCoverage[]
  readonly notes: string
  /** Apaga o corpus antes de gravar (só desenvolvimento, CI e testes; nunca na ingestão real). */
  readonly replace: boolean
}

export type WriteCorpus = (command: WriteCorpusCommand) => Promise<CorpusWriteResult>

interface PendingChunk {
  readonly ordinal: number
  readonly content: string
  readonly contentHash: string
  /** `embeddingText(heading_path, content)`; o hash dele é a chave do vetor (e do cache). */
  readonly embeddingInput: string
  readonly embeddingHash: string
}

function knowledgeOf(version: SourceProvisionVersion, doc: SourceDocument): ValidityInterval {
  if (version.knowledge !== undefined) {
    return version.knowledge
  }
  const published = doc.versions
    .filter((candidate) => version.documentVersions.includes(candidate.key))
    .map((candidate) => candidate.publishedOn)
    .sort()
  const from = published[0]
  if (from === undefined) {
    throw new RangeError(
      `redação de ${version.displayLabel} sem versão de documento conhecida em ${doc.slug}`,
    )
  }
  return { from, to: null }
}

async function embedAll(
  embeddings: EmbeddingPort,
  texts: readonly string[],
  hasher: ContentHasher,
): Promise<Map<string, number[]>> {
  const byHash = new Map<string, string>()
  for (const text of texts) {
    byHash.set(hasher.hash(text), text)
  }
  const entries = [...byHash.entries()]
  const vectors = new Map<string, number[]>()
  for (const indexes of planEmbeddingBatches(entries.map(([, text]) => text))) {
    const batch = indexes
      .map((index) => entries[index])
      .filter((entry): entry is [string, string] => entry !== undefined)
    const result = await embeddings.embed(batch.map(([, text]) => text))
    for (const [index, [hash]] of batch.entries()) {
      const vector = result[index]
      if (vector === undefined || vector.length !== embeddings.dimensions) {
        throw new RangeError(`embedding com dimensão inválida para o hash ${hash}`)
      }
      vectors.set(hash, vector)
    }
  }
  return vectors
}

export function createWriteCorpus(deps: {
  readonly writer: CorpusWriter
  readonly embeddings: EmbeddingPort
  readonly hasher: ContentHasher
}): WriteCorpus {
  return async ({ documents, coverage, notes, replace }) => {
    const pending = new Map<SourceProvisionVersion, PendingChunk[]>()
    for (const doc of documents) {
      for (const provision of doc.provisions) {
        for (const version of provision.versions) {
          pending.set(
            version,
            chunkText(version.text, version.displayLabel).map((piece) => {
              const embeddingInput = embeddingText(provision.headingPath, piece.content)
              return {
                ordinal: piece.ordinal,
                content: piece.content,
                contentHash: deps.hasher.hash(piece.content),
                embeddingInput,
                embeddingHash: deps.hasher.hash(embeddingInput),
              }
            }),
          )
        }
      }
    }
    const vectors = await embedAll(
      deps.embeddings,
      [...pending.values()].flat().map((chunk) => chunk.embeddingInput),
      deps.hasher,
    )

    const records: DocumentRecord[] = documents.map((doc) => ({
      slug: doc.slug,
      family: doc.family,
      jurisdiction: jurisdictionOf(doc.family),
      title: doc.title,
      issuer: doc.issuer,
      sourceUrl: doc.sourceUrl,
      versions: doc.versions,
      provisions: doc.provisions.map((provision) => ({
        stableKey: provision.stableKey,
        kind: provision.kind,
        parentStableKey: provision.parent ?? null,
        sortPath: provision.sortPath,
        headingPath: provision.headingPath,
        versions: provision.versions.map(
          (version): ProvisionVersionRecord => ({
            displayLabel: version.displayLabel,
            validDuring: version.validDuring,
            knowledge: knowledgeOf(version, doc),
            modality: version.modality,
            validityBasis: version.validityBasis,
            retroactive: version.retroactive,
            reviewStatus: version.reviewStatus,
            text: version.text,
            contentHash: deps.hasher.hash(version.text),
            structured: version.structured ?? null,
            amendment: version.amendment ?? null,
            documentVersionKeys: version.documentVersions,
            // Toda redação passou pelo laço de chunking acima, e o embedAll tem vetor para todo hash.
            chunks: (pending.get(version) as PendingChunk[]).map(
              (chunk): ChunkRecord => ({
                ordinal: chunk.ordinal,
                content: chunk.content,
                contentHash: chunk.contentHash,
                embedding: vectors.get(chunk.embeddingHash) as number[],
              }),
            ),
          }),
        ),
      })),
    }))

    return deps.writer.write({
      documents: records,
      coverage: coverage.map((entry) => ({
        family: entry.family,
        jurisdiction: jurisdictionOf(entry.family) satisfies Jurisdiction,
        covered: entry.covered,
        verifiedAt: entry.verifiedAt,
        gaps: entry.gaps.map((gap) => gap.interval),
        gapReason: entry.gaps.map((gap) => gap.reason).join('; ') || null,
      })),
      embeddingModel: deps.embeddings.model,
      notes,
      replace,
    })
  }
}
