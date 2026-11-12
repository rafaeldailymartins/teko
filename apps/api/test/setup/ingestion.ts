import { sha256ContentHasher } from '#adapters/out/crypto/sha256-content-hasher.ts'
import {
  createFakeEmbeddingAdapter,
  readEmbeddingFixture,
} from '#adapters/out/fakes/fake-embedding-adapter.ts'
import type { InMemoryBlobStore } from '#adapters/out/fakes/in-memory-blob-store.ts'
import { createInMemoryBlobStore } from '#adapters/out/fakes/in-memory-blob-store.ts'
import type { IngestionContainer } from '#app/container.ts'
import type { EmbeddingPort } from '#app/ports/embedding-port.ts'
import type { BatchLimits } from '#app/services/embedding-batches.ts'
import { createIngestionContainer } from '../../src/composition-root.ts'
import { parseEnv } from '../../src/config/env.ts'
import { FIXED_NOW, FIXTURE_EMBEDDINGS } from './corpus.ts'

/**
 * Container de ingestão apontado para um banco de teste (owner), com o fake de embeddings da
 * fixture (fora do modo strict: textos novos ganham vetor determinístico) embrulhado num espião que
 * conta as chamadas e informa `neuronsPerCall` neurons por chamada ao medidor.
 */

export interface EmbeddingSpy {
  readonly calls: string[][]
  texts(): number
  reset(): void
}

export interface IngestionTestContext {
  readonly container: IngestionContainer
  readonly spy: EmbeddingSpy
  readonly blobs: InMemoryBlobStore
}

const fixture = readEmbeddingFixture(FIXTURE_EMBEDDINGS)

export function createIngestionTestContext(
  ownerUrl: string,
  options: {
    readonly budget?: number
    readonly maxDatabaseBytes?: number
    readonly neuronsPerCall?: number
    readonly batchLimits?: BatchLimits
    readonly blobs?: InMemoryBlobStore
    readonly strict?: boolean
    readonly spy?: EmbeddingSpy
  } = {},
): IngestionTestContext {
  const env = parseEnv({
    APP_ENV: 'ci',
    WEB_ORIGIN: 'http://localhost:3000',
    EMBEDDINGS_PROVIDER: 'fake',
    EMBEDDINGS_FIXTURE_PATH: FIXTURE_EMBEDDINGS,
  })
  const calls: string[][] = options.spy?.calls ?? []
  const spy: EmbeddingSpy = options.spy ?? {
    calls,
    texts: () => calls.reduce((sum, call) => sum + call.length, 0),
    reset: () => {
      calls.length = 0
    },
  }
  const blobs = options.blobs ?? createInMemoryBlobStore()
  const fake = createFakeEmbeddingAdapter({
    fixture,
    hasher: sha256ContentHasher,
    strict: options.strict ?? false,
  })
  const container = createIngestionContainer(
    env,
    {
      databaseUrl: ownerUrl,
      ...(options.budget === undefined ? {} : { embedNeuronBudget: options.budget }),
      ...(options.maxDatabaseBytes === undefined
        ? {}
        : { maxDatabaseBytes: options.maxDatabaseBytes }),
    },
    {
      blobStore: blobs,
      clock: { now: () => new Date(FIXED_NOW) },
      ...(options.batchLimits === undefined ? {} : { embeddingBatchLimits: options.batchLimits }),
      embeddings: (meter): EmbeddingPort => ({
        model: fake.model,
        dimensions: fake.dimensions,
        async embed(texts, embedOptions) {
          spy.calls.push([...texts])
          const vectors = await fake.embed(texts, embedOptions)
          meter.record({ neurons: options.neuronsPerCall ?? 1, texts: texts.length })
          return vectors
        },
      }),
    },
  )
  return { container, spy, blobs }
}
