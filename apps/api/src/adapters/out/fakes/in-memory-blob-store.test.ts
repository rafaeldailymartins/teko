import { describe, expect, it } from 'vitest'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import { createInMemoryBlobStore } from './in-memory-blob-store.ts'

describe('InMemoryBlobStore', () => {
  it('grava, lê, lista por prefixo e apaga, isolando os stores', async () => {
    const store = createInMemoryBlobStore()
    await store.set(BlobStoreName.CorpusSnapshots, 'snapshots/2/b', 'texto')
    await store.set(BlobStoreName.CorpusSnapshots, 'snapshots/10/a', new Uint8Array([1, 2]))
    await store.set(BlobStoreName.CorpusRaw, 'snapshots/x', 'outro store')
    expect(
      new TextDecoder().decode(
        (await store.get(BlobStoreName.CorpusSnapshots, 'snapshots/2/b')) ?? undefined,
      ),
    ).toBe('texto')
    expect(await store.list(BlobStoreName.CorpusSnapshots, 'snapshots/1')).toEqual([
      'snapshots/10/a',
    ])
    expect(await store.list(BlobStoreName.CorpusSnapshots)).toEqual([
      'snapshots/10/a',
      'snapshots/2/b',
    ])
    expect(store.keys(BlobStoreName.CorpusRaw)).toEqual(['snapshots/x'])
    await store.delete(BlobStoreName.CorpusSnapshots, 'snapshots/2/b')
    expect(await store.get(BlobStoreName.CorpusSnapshots, 'snapshots/2/b')).toBeNull()
  })

  it('copia os bytes na entrada e na saída', async () => {
    const store = createInMemoryBlobStore()
    const data = new Uint8Array([1, 2, 3])
    await store.set(BlobStoreName.EvalArtifacts, 'k', data)
    data[0] = 9
    const read = await store.get(BlobStoreName.EvalArtifacts, 'k')
    expect(read).toEqual(new Uint8Array([1, 2, 3]))
    if (read !== null) {
      read[1] = 9
    }
    expect(await store.get(BlobStoreName.EvalArtifacts, 'k')).toEqual(new Uint8Array([1, 2, 3]))
  })
})
