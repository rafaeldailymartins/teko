import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import type { ContentHasher } from '#app/ports/content-hasher.ts'
import type { EmbeddingPort } from '#app/ports/embedding-port.ts'
import { decodeHalfVector } from './half-float.ts'

/**
 * `FakeEmbeddingAdapter` (`EMBEDDINGS_PROVIDER=fake`, proibido em staging e produção): procura o
 * vetor pelo `content_hash` na fixture `embeddings.json.gz` (vetores BGE-M3 reais, gravados uma vez
 * por `pnpm fixtures:embed`). Num miss:
 * - modo `strict` (evals e e2e): falha, porque um vetor inventado mascararia a qualidade da busca;
 * - fora dele: gera um vetor determinístico semeado pelo hash (desenvolvimento local).
 */

const embeddingFixtureSchema = z.strictObject({
  model: z.string().min(1),
  dimensions: z.int().positive(),
  /** `content_hash` → vetor float16 little-endian em base64. */
  vectors: z.record(z.string().regex(/^[0-9a-f]{64}$/), z.string().min(1)),
})
export type EmbeddingFixture = z.output<typeof embeddingFixtureSchema>

export class FixtureEmbeddingMissError extends Error {
  constructor(hash: string, text: string) {
    super(
      `Embedding ausente da fixture para o hash ${hash} ("${text.slice(0, 60)}..."). ` +
        'Rode `pnpm --filter @teko/api fixtures:embed` depois de mudar a fixture ou o golden.',
    )
    this.name = 'FixtureEmbeddingMissError'
  }
}

export function readEmbeddingFixture(path: string): EmbeddingFixture {
  return embeddingFixtureSchema.parse(JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')))
}

/** Vetor unitário pseudoaleatório e determinístico, derivado do hash (sha256 em cadeia). */
export function seededVector(hash: string, dimensions: number): number[] {
  const values: number[] = []
  let block = Buffer.from(hash, 'hex')
  while (values.length < dimensions) {
    block = createHash('sha256').update(block).digest()
    for (let offset = 0; offset + 2 <= block.length && values.length < dimensions; offset += 2) {
      values.push(block.readUInt16LE(offset) / 32_768 - 1)
    }
  }
  const norm = Math.hypot(...values) || 1
  return values.map((value) => value / norm)
}

export interface FakeEmbeddingOptions {
  readonly fixture: EmbeddingFixture
  readonly hasher: ContentHasher
  readonly strict: boolean
}

export function createFakeEmbeddingAdapter(options: FakeEmbeddingOptions): EmbeddingPort {
  const { fixture, hasher, strict } = options
  const cache = new Map<string, number[]>()
  const vectorFor = (text: string): number[] => {
    const hash = hasher.hash(text)
    const cached = cache.get(hash)
    if (cached !== undefined) {
      return cached
    }
    const encoded = fixture.vectors[hash]
    if (encoded === undefined && strict) {
      throw new FixtureEmbeddingMissError(hash, text)
    }
    const vector =
      encoded === undefined ? seededVector(hash, fixture.dimensions) : decodeHalfVector(encoded)
    if (vector.length !== fixture.dimensions) {
      throw new RangeError(`vetor da fixture com ${String(vector.length)} dimensões (hash ${hash})`)
    }
    cache.set(hash, vector)
    return vector
  }
  return {
    model: fixture.model,
    dimensions: fixture.dimensions,
    // async: um miss em strict ou o sinal abortado viram promise rejeitada, como num provedor real,
    // e não exceção síncrona.
    embed: async (texts, embedOptions) => {
      embedOptions?.signal?.throwIfAborted()
      return texts.map(vectorFor)
    },
  }
}
