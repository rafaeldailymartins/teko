import type { BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * `BlobStore` em memória: testes e execução local sem `NETLIFY_AUTH_TOKEN`. Copia os bytes na
 * entrada e na saída, como um store remoto (quem grava não altera o que foi gravado).
 */
export interface InMemoryBlobStore extends BlobStore {
  /** Chaves gravadas no store (para asserções nos testes). */
  keys(store: BlobStoreName): string[]
}

export function createInMemoryBlobStore(): InMemoryBlobStore {
  const stores = new Map<BlobStoreName, Map<string, Uint8Array>>()
  const storeOf = (name: BlobStoreName): Map<string, Uint8Array> => {
    let store = stores.get(name)
    if (store === undefined) {
      store = new Map()
      stores.set(name, store)
    }
    return store
  }
  const keys = (name: BlobStoreName): string[] => [...storeOf(name).keys()].sort(compareCodeUnits)
  return {
    get: (name, key) => {
      const data = storeOf(name).get(key)
      return Promise.resolve(data === undefined ? null : new Uint8Array(data))
    },
    set: (name, key, data) => {
      storeOf(name).set(
        key,
        typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data),
      )
      return Promise.resolve()
    },
    list: (name, prefix = '') =>
      Promise.resolve(keys(name).filter((key) => key.startsWith(prefix))),
    delete: (name, key) => {
      storeOf(name).delete(key)
      return Promise.resolve()
    },
    keys,
  }
}
