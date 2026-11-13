import { describe, expect, it } from 'vitest'
import type {
  CorpusIngestionRepository,
  OpenChunkText,
} from '../ports/corpus-ingestion-repository.ts'
import type { EmbeddingCache } from '../ports/embedding-cache.ts'
import { createPruneEmbeddingCache } from './prune-embedding-cache.ts'

const fail = () => Promise.reject(new Error('não usado'))

describe('PruneEmbeddingCache', () => {
  it('mantém só os hashes de embeddingText dos chunks abertos', async () => {
    const pages: OpenChunkText[][] = [
      [{ headingPath: 'RCTE > Art. 1', content: 'Art. 1. Texto.' }],
      [
        { headingPath: 'RCTE > Art. 2', content: 'Art. 2. Texto.' },
        { headingPath: 'RCTE > Art. 1', content: 'Art. 1. Texto.' },
      ],
    ]
    const repository: CorpusIngestionRepository = {
      findDocumentVersion: fail,
      findPublishedByFingerprint: fail,
      openVersionsOf: fail,
      transaction: fail,
      refreshCoverage: fail,
      documentHealth: fail,
      openReviewQueue: fail,
      async *openChunkTexts() {
        for (const page of pages) {
          yield page
        }
      },
    }
    const calls: [string, string[]][] = []
    const cache: EmbeddingCache = {
      getMany: fail,
      putMany: fail,
      retainOnly: (model, keep) => {
        calls.push([model, [...keep].sort()])
        return Promise.resolve(4)
      },
    }
    const prune = createPruneEmbeddingCache({
      repository,
      cache,
      hasher: { hash: (text) => `#${text}` },
      embeddingModel: 'bge',
    })
    expect(await prune()).toEqual({ removed: 4, kept: 2 })
    expect(calls).toEqual([
      ['bge', ['#RCTE > Art. 1\n\nArt. 1. Texto.', '#RCTE > Art. 2\n\nArt. 2. Texto.']],
    ])
  })
})
