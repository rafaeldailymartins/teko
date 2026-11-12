import { describe, expect, it } from 'vitest'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import {
  createNetlifyBlobStore,
  NETLIFY_BLOBS_REGION,
  type NetlifyStoreClient,
  type NetlifyStoreOptions,
} from './netlify-blob-store.ts'

function fakeFactory() {
  const created: NetlifyStoreOptions[] = []
  const data = new Map<string, Map<string, ArrayBuffer | string>>()
  const factory = (options: NetlifyStoreOptions): NetlifyStoreClient => {
    created.push(options)
    const store = new Map<string, ArrayBuffer | string>()
    data.set(options.name, store)
    return {
      get: (key) => {
        const value = store.get(key)
        if (value === undefined) {
          return Promise.resolve(null)
        }
        return Promise.resolve(
          typeof value === 'string' ? new TextEncoder().encode(value).buffer : value,
        )
      },
      set: (key, value) => {
        store.set(key, value)
        return Promise.resolve({ modified: true })
      },
      delete: (key) => {
        store.delete(key)
        return Promise.resolve()
      },
      async *list(options) {
        const keys = [...store.keys()].filter((key) => key.startsWith(options.prefix ?? ''))
        // Duas páginas, em ordem invertida: o adapter junta e ordena.
        yield {
          blobs: keys
            .slice(1)
            .reverse()
            .map((key) => ({ key })),
        }
        yield { blobs: keys.slice(0, 1).map((key) => ({ key })) }
      },
    }
  }
  return { factory, created, data }
}

describe('createNetlifyBlobStore', () => {
  it('abre cada store uma vez, com siteID, token, consistência forte e região us-east-2', async () => {
    const { factory, created } = fakeFactory()
    const blobs = createNetlifyBlobStore({ siteID: 'site', token: 'pat', getStore: factory })
    await blobs.set(BlobStoreName.CorpusRaw, 'a', 'x')
    await blobs.get(BlobStoreName.CorpusRaw, 'a')
    await blobs.get(BlobStoreName.CorpusDocling, 'b')
    expect(created).toEqual([
      {
        name: 'corpus-raw',
        siteID: 'site',
        token: 'pat',
        consistency: 'strong',
        region: NETLIFY_BLOBS_REGION,
      },
      {
        name: 'corpus-docling',
        siteID: 'site',
        token: 'pat',
        consistency: 'strong',
        region: 'us-east-2',
      },
    ])
  })

  it('grava bytes e texto, lê como Uint8Array e devolve null para chave ausente', async () => {
    const { factory, data } = fakeFactory()
    const blobs = createNetlifyBlobStore({ siteID: 'site', token: 'pat', getStore: factory })
    const view = new Uint8Array([0, 1, 2, 3, 4]).subarray(1, 4)
    await blobs.set(BlobStoreName.CorpusRaw, 'bin', view)
    await blobs.set(BlobStoreName.CorpusRaw, 'txt', 'olá')
    const stored = data.get('corpus-raw')?.get('bin')
    expect(stored).toBeInstanceOf(ArrayBuffer)
    expect(stored instanceof ArrayBuffer ? stored.byteLength : -1).toBe(3)
    expect(await blobs.get(BlobStoreName.CorpusRaw, 'bin')).toEqual(new Uint8Array([1, 2, 3]))
    expect(
      new TextDecoder().decode((await blobs.get(BlobStoreName.CorpusRaw, 'txt')) ?? undefined),
    ).toBe('olá')
    expect(await blobs.get(BlobStoreName.CorpusRaw, 'nada')).toBeNull()
  })

  it('lista todas as páginas em ordem, com e sem prefixo, e apaga', async () => {
    const { factory } = fakeFactory()
    const blobs = createNetlifyBlobStore({ siteID: 'site', token: 'pat', getStore: factory })
    for (const key of ['rcte/b', 'rcte/a', 'cte/c']) {
      await blobs.set(BlobStoreName.CorpusRaw, key, key)
    }
    expect(await blobs.list(BlobStoreName.CorpusRaw)).toEqual(['cte/c', 'rcte/a', 'rcte/b'])
    expect(await blobs.list(BlobStoreName.CorpusRaw, 'rcte/')).toEqual(['rcte/a', 'rcte/b'])
    await blobs.delete(BlobStoreName.CorpusRaw, 'rcte/a')
    expect(await blobs.list(BlobStoreName.CorpusRaw, 'rcte/')).toEqual(['rcte/b'])
  })

  it('exige siteID e token, sem citar os valores', () => {
    expect(() => createNetlifyBlobStore({ siteID: ' ', token: 'segredo' })).toThrow(
      /NETLIFY_SITE_ID e NETLIFY_AUTH_TOKEN/,
    )
    expect(() => createNetlifyBlobStore({ siteID: 'site', token: '' })).not.toThrow(/segredo/)
  })

  it('usa o SDK quando nenhuma fábrica é injetada', () => {
    expect(() => createNetlifyBlobStore({ siteID: 'site', token: 'pat' })).not.toThrow()
  })
})
