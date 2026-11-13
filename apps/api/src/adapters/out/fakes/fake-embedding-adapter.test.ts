import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { tempDir } from '../../../../test/setup/temp-dir.ts'
import { sha256ContentHasher } from '../crypto/sha256-content-hasher.ts'
import {
  createFakeEmbeddingAdapter,
  type EmbeddingFixture,
  FixtureEmbeddingMissError,
  readEmbeddingFixture,
  seededVector,
} from './fake-embedding-adapter.ts'
import { encodeHalfVector } from './half-float.ts'

const KNOWN = 'texto conhecido'
const fixture: EmbeddingFixture = {
  model: '@cf/baai/bge-m3',
  dimensions: 4,
  vectors: { [sha256ContentHasher.hash(KNOWN)]: encodeHalfVector([1, 0, -0.5, 0.25]) },
}

describe('createFakeEmbeddingAdapter', () => {
  it('devolve o vetor da fixture pelo content_hash (com a normalização do hash)', async () => {
    const fake = createFakeEmbeddingAdapter({ fixture, hasher: sha256ContentHasher, strict: true })
    expect(fake.model).toBe('@cf/baai/bge-m3')
    expect(fake.dimensions).toBe(4)
    await expect(fake.embed([KNOWN, `  ${KNOWN}​ `])).resolves.toEqual([
      [1, 0, -0.5, 0.25],
      [1, 0, -0.5, 0.25],
    ])
  })

  it('em strict, um miss falha com a instrução de regenerar', async () => {
    const fake = createFakeEmbeddingAdapter({ fixture, hasher: sha256ContentHasher, strict: true })
    await expect(fake.embed(['inédito'])).rejects.toThrow(FixtureEmbeddingMissError)
    await expect(fake.embed(['inédito'])).rejects.toThrow(/fixtures:embed/)
  })

  it('fora do strict, um miss vira vetor unitário determinístico', async () => {
    const fake = createFakeEmbeddingAdapter({ fixture, hasher: sha256ContentHasher, strict: false })
    const [first] = await fake.embed(['inédito'])
    const [second] = await fake.embed(['inédito'])
    expect(first).toHaveLength(4)
    expect(first).toEqual(second)
    expect(Math.hypot(...(first ?? []))).toBeCloseTo(1, 10)
  })

  it('respeita o sinal abortado e recusa vetor de dimensão errada', async () => {
    const fake = createFakeEmbeddingAdapter({ fixture, hasher: sha256ContentHasher, strict: true })
    await expect(fake.embed([KNOWN], { signal: AbortSignal.abort() })).rejects.toThrow()
    const wrong = createFakeEmbeddingAdapter({
      fixture: { ...fixture, dimensions: 3 },
      hasher: sha256ContentHasher,
      strict: true,
    })
    await expect(wrong.embed([KNOWN])).rejects.toThrow(/4 dimensões/)
  })
})

describe('seededVector e readEmbeddingFixture', () => {
  it('o vetor semeado é unitário, determinístico e varia com o hash', () => {
    const hash = sha256ContentHasher.hash('a')
    const vector = seededVector(hash, 1024)
    expect(vector).toHaveLength(1024)
    expect(Math.hypot(...vector)).toBeCloseTo(1, 10)
    expect(seededVector(hash, 1024)).toEqual(vector)
    expect(seededVector(sha256ContentHasher.hash('b'), 1024)).not.toEqual(vector)
  })

  it('lê o JSON gzip e valida o formato', () => {
    const dir = tempDir('teko-fixture-')
    const good = join(dir, 'ok.json.gz')
    writeFileSync(good, gzipSync(JSON.stringify(fixture)))
    expect(readEmbeddingFixture(good)).toEqual(fixture)
    const bad = join(dir, 'bad.json.gz')
    writeFileSync(bad, gzipSync(JSON.stringify({ ...fixture, vectors: { xyz: 'a' } })))
    expect(() => readEmbeddingFixture(bad)).toThrow()
  })

  it('a fixture versionada cobre todos os chunks da fixture e as perguntas do golden', async () => {
    const { fixtureTexts } = await import('../../../../evals/scripts/fixtures-embed.ts')
    const real = readEmbeddingFixture('test/fixtures/corpus/embeddings.json.gz')
    expect(real.dimensions).toBe(1024)
    const missing = fixtureTexts('test/fixtures/corpus').filter(
      (text) => real.vectors[sha256ContentHasher.hash(text)] === undefined,
    )
    expect(missing).toEqual([])
  })
})
