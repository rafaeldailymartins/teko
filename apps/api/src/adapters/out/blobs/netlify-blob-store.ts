import { getStore } from '@netlify/blobs'
import type { BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * `BlobStore` sobre o Netlify Blobs (`@netlify/blobs` 11.1.7; Context7 `/netlify/primitives`),
 * fora da Netlify: stores do site (`getStore({ name, siteID, token })`), com o PAT do environment
 * (`NETLIFY_AUTH_TOKEN`) e o site `tekoia` (`NETLIFY_SITE_ID`). Escolhas do plano:
 *
 * - `consistency: 'strong'`: o `discover` confere o `docling.json` gravado por um run anterior e o
 *   `load` grava e lê na mesma execução; leitura eventual (até 60 s) faria o Docling rodar à toa;
 * - `region: 'us-east-2'`, fixa: sem ela a API escolhe a região padrão (stores do site não herdam a
 *   região das Functions), e os dados de um store não mudam de região depois de gravados.
 *
 * O token nunca entra em mensagem de erro nem em log (os erros do SDK citam só a URL da API).
 */

export const NETLIFY_BLOBS_REGION = 'us-east-2'

/** O que este adapter usa de um `Store` do SDK (injetável nos testes). */
export interface NetlifyStoreClient {
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>
  set(key: string, data: string | ArrayBuffer): Promise<unknown>
  delete(key: string): Promise<void>
  list(options: { prefix?: string; paginate: true }): AsyncIterable<{
    blobs: readonly { key: string }[]
  }>
}

export interface NetlifyStoreOptions {
  readonly name: BlobStoreName
  readonly siteID: string
  readonly token: string
  readonly consistency: 'strong'
  readonly region: typeof NETLIFY_BLOBS_REGION
}

type NetlifyStoreFactory = (options: NetlifyStoreOptions) => NetlifyStoreClient

export interface NetlifyBlobStoreConfig {
  readonly siteID: string
  readonly token: string
  /** Fábrica de stores (padrão: `getStore` do SDK). */
  readonly getStore?: NetlifyStoreFactory
}

const sdkStore: NetlifyStoreFactory = (options) => getStore(options)

/** Cópia em `ArrayBuffer` próprio (o SDK aceita `ArrayBuffer`, não uma vista com deslocamento). */
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(data.byteLength)
  new Uint8Array(copy).set(data)
  return copy
}

export function createNetlifyBlobStore(config: NetlifyBlobStoreConfig): BlobStore {
  if (config.siteID.trim() === '' || config.token.trim() === '') {
    throw new Error('Netlify Blobs exige NETLIFY_SITE_ID e NETLIFY_AUTH_TOKEN')
  }
  const factory = config.getStore ?? sdkStore
  const stores = new Map<BlobStoreName, NetlifyStoreClient>()
  const storeOf = (name: BlobStoreName): NetlifyStoreClient => {
    let store = stores.get(name)
    if (store === undefined) {
      store = factory({
        name,
        siteID: config.siteID,
        token: config.token,
        consistency: 'strong',
        region: NETLIFY_BLOBS_REGION,
      })
      stores.set(name, store)
    }
    return store
  }
  return {
    async get(name, key) {
      const data = await storeOf(name).get(key, { type: 'arrayBuffer' })
      return data === null ? null : new Uint8Array(data)
    },
    async set(name, key, data) {
      await storeOf(name).set(key, typeof data === 'string' ? data : toArrayBuffer(data))
    },
    async list(name, prefix) {
      const keys: string[] = []
      const options =
        prefix === undefined ? { paginate: true as const } : { prefix, paginate: true as const }
      for await (const page of storeOf(name).list(options)) {
        keys.push(...page.blobs.map((blob) => blob.key))
      }
      return keys.sort(compareCodeUnits)
    },
    async delete(name, key) {
      await storeOf(name).delete(key)
    },
  }
}
