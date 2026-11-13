import { embeddingText } from '#domain/corpus/chunker.ts'
import type { ContentHasher } from '../ports/content-hasher.ts'
import type { CorpusIngestionRepository } from '../ports/corpus-ingestion-repository.ts'
import type { EmbeddingCache } from '../ports/embedding-cache.ts'

/**
 * `PruneEmbeddingCache` (fim de um run verde que cobriu todas as famílias): apaga do
 * `embedding_cache` os vetores que nenhum chunk de conhecimento aberto usa (a chave é o hash de
 * `embeddingText(heading_path, conteúdo)`, a mesma do `IngestDocumentVersion`). O cache é o
 * checkpoint do orçamento; depois de um run verde completo, o que sobra nele só ocupa espaço.
 */
export type PruneEmbeddingCache = () => Promise<{ readonly removed: number; readonly kept: number }>

export function createPruneEmbeddingCache(deps: {
  readonly repository: CorpusIngestionRepository
  readonly cache: EmbeddingCache
  readonly hasher: ContentHasher
  readonly embeddingModel: string
}): PruneEmbeddingCache {
  return async () => {
    const keep = new Set<string>()
    for await (const batch of deps.repository.openChunkTexts()) {
      for (const chunk of batch) {
        keep.add(deps.hasher.hash(embeddingText(chunk.headingPath, chunk.content)))
      }
    }
    const removed = await deps.cache.retainOnly(deps.embeddingModel, keep)
    return { removed, kept: keep.size }
  }
}
