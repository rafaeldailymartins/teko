import { createHash } from 'node:crypto'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'

/**
 * `BlobStore` sobre os releases do próprio repositório no GitHub (ADR 0030; API REST de releases,
 * Context7 `/websites/github_en_rest`). Os artefatos da ingestão são públicos por natureza (textos
 * de legislação, saídas do Docling, snapshots do corpus, estado do watch), e o GitHub Releases não
 * tem cota de banda nem de armazenamento para repositório público.
 *
 * Releases e assets (todos `prerelease: true`, `make_latest: "false"`, nunca `v*`):
 *
 * - `corpus-snapshots`: `snapshots/<N>/<arquivo>` → release `corpus-v<N>`, asset `<arquivo>`.
 *   Apagar o último asset apaga o release e a tag (retenção do `ExportSnapshot`).
 * - demais stores: release `<base>-<shard>`, com `shard` = `sha256(chave) mod shards`, em hex, e o
 *   asset nomeado pela chave com `/` trocado por `__` (`rcte/rcte-go/2026-11-06/<sha256>.htm` →
 *   `rcte__rcte-go__2026-11-06__<sha256>.htm`). O shard mantém cada release longe do limite de
 *   1000 assets do GitHub (`RELEASE_ASSET_LIMIT`); o nome reversível dispensa índice.
 *
 * Integridade: o GitHub devolve o `digest` (`sha256:<hex>`) de cada asset. O download confere o
 * `digest` (e o tamanho); o upload confere o `digest` devolvido contra o sha256 dos bytes enviados,
 * e um `set` com o mesmo conteúdo de um asset existente não faz nada (idempotente). Não há
 * sobrescrita atômica: trocar um asset é apagar e subir de novo (o GitHub recusa nome repetido).
 *
 * O token (`GITHUB_TOKEN` do job, com `contents: write` só nos jobs que gravam) nunca entra em
 * mensagem de erro: os erros citam método, caminho e status.
 */

const GITHUB_API_URL = 'https://api.github.com'
const GITHUB_UPLOADS_URL = 'https://uploads.github.com'

/** Limite de assets por release do GitHub. */
export const RELEASE_ASSET_LIMIT = 1000

/** Maior nome de asset aceito aqui (o GitHub não documenta o teto; 255 é o dos sistemas de arquivo). */
const MAX_ASSET_NAME_LENGTH = 255

/** Prefixo das tags de snapshot: `corpus-v<N>`. */
const SNAPSHOT_TAG_PREFIX = 'corpus-v'

/** Release de cada store com shard: prefixo da tag e número de shards (nunca mude sem migrar). */
export const SHARDED_STORES = {
  [BlobStoreName.CorpusRaw]: { tagPrefix: 'corpus-raw', shards: 16 },
  [BlobStoreName.CorpusDocling]: { tagPrefix: 'corpus-docling', shards: 16 },
  [BlobStoreName.CorpusManifests]: { tagPrefix: 'corpus-watch-state', shards: 4 },
  [BlobStoreName.EvalArtifacts]: { tagPrefix: 'corpus-eval-history', shards: 4 },
} as const satisfies Record<Exclude<BlobStoreName, 'corpus-snapshots'>, unknown>

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const SNAPSHOT_KEY = /^snapshots\/(\d+)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/
const SNAPSHOT_TAG = /^corpus-v(\d+)$/
const PATH_SEPARATOR = '__'

const RELEASE_BODY =
  'Artefatos da ingestão do Tekó (ADR 0030), gravados pelo GitHub Actions. Não é uma versão do produto.'

export class GithubReleasesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GithubReleasesError'
  }
}

/** Onde uma chave mora: a tag do release e o nome do asset. */
export interface AssetLocation {
  readonly tag: string
  readonly name: string
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function assertKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes(PATH_SEPARATOR)) {
    throw new GithubReleasesError(
      `chave ${JSON.stringify(key)} fora do formato aceito pelo GitHub Releases (letras, dígitos, ".", "-", "_" e "/", sem ".." nem "__")`,
    )
  }
}

/** Tag e nome do asset de uma chave (função pura, também usada pela migração e pelos testes). */
export function assetLocation(store: BlobStoreName, key: string): AssetLocation {
  assertKey(key)
  if (store === BlobStoreName.CorpusSnapshots) {
    const match = SNAPSHOT_KEY.exec(key)
    if (match?.[1] === undefined || match[2] === undefined) {
      throw new GithubReleasesError(
        `chave de snapshot ${JSON.stringify(key)} fora de snapshots/<versão>/<arquivo>`,
      )
    }
    return { tag: `${SNAPSHOT_TAG_PREFIX}${String(Number(match[1]))}`, name: match[2] }
  }
  const { tagPrefix, shards } = SHARDED_STORES[store]
  const shard = Number.parseInt(sha256Hex(key).slice(0, 8), 16) % shards
  const name = key.replaceAll('/', PATH_SEPARATOR)
  if (name.length > MAX_ASSET_NAME_LENGTH) {
    throw new GithubReleasesError(
      `chave com ${String(name.length)} caracteres (máximo ${String(MAX_ASSET_NAME_LENGTH)}): ${key}`,
    )
  }
  return { tag: `${tagPrefix}-${shard.toString(16)}`, name }
}

/** Chave de volta a partir do asset (inverso de `assetLocation`). */
function keyOf(store: BlobStoreName, tag: string, name: string): string {
  if (store === BlobStoreName.CorpusSnapshots) {
    const version = SNAPSHOT_TAG.exec(tag)?.[1]
    return `snapshots/${version ?? ''}/${name}`
  }
  return name.replaceAll(PATH_SEPARATOR, '/')
}

/** Tags de todos os shards de um store com shard. */
function shardTags(store: Exclude<BlobStoreName, 'corpus-snapshots'>): string[] {
  const { tagPrefix, shards } = SHARDED_STORES[store]
  return Array.from({ length: shards }, (_, shard) => `${tagPrefix}-${shard.toString(16)}`)
}

interface AssetInfo {
  readonly id: number
  readonly name: string
  readonly size: number
  /** sha256 em hex, quando o GitHub já calculou o `digest`. */
  readonly sha256: string | null
}

interface ReleaseState {
  readonly id: number
  readonly tag: string
  readonly assets: Map<string, AssetInfo>
}

export interface GithubReleasesBlobStoreConfig {
  /** `owner/repo` (`GITHUB_REPOSITORY` no Actions). */
  readonly repository: string
  readonly token: string
  /** `fetch` injetável (testes). */
  readonly fetch?: typeof fetch
  readonly apiUrl?: string
  readonly uploadsUrl?: string
}

/** O que a migração usa além da porta: o sha256 de um asset sem baixá-lo. */
interface DigestReader {
  /** sha256 em hex do conteúdo gravado, ou `null` se a chave não existe. */
  sha256Of(store: BlobStoreName, key: string): Promise<string | null>
}

export type GithubReleasesBlobStore = BlobStore & DigestReader

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new GithubReleasesError(`${what}: resposta não é JSON`)
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined
}

function assetFrom(value: unknown): AssetInfo {
  const id = field(value, 'id')
  const name = field(value, 'name')
  const size = field(value, 'size')
  const digest = field(value, 'digest')
  if (typeof id !== 'number' || typeof name !== 'string' || typeof size !== 'number') {
    throw new GithubReleasesError('asset sem id, name ou size na resposta do GitHub')
  }
  const sha256 =
    typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(digest) ? digest.slice(7) : null
  return { id, name, size, sha256 }
}

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([500, 502, 503, 504])
const MAX_ATTEMPTS = 3
const PAGE_SIZE = 100

export function createGithubReleasesBlobStore(
  config: GithubReleasesBlobStoreConfig,
): GithubReleasesBlobStore {
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(config.repository)) {
    throw new GithubReleasesError('GITHUB_REPOSITORY deve ser owner/repo')
  }
  if (config.token.trim() === '') {
    throw new GithubReleasesError('GitHub Releases exige GITHUB_TOKEN')
  }
  const doFetch = config.fetch ?? fetch
  const apiUrl = config.apiUrl ?? GITHUB_API_URL
  const uploadsUrl = config.uploadsUrl ?? GITHUB_UPLOADS_URL
  const repoPath = `/repos/${config.repository}`
  const releases = new Map<string, ReleaseState | null>()
  let snapshotTags: string[] | null = null

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${config.token}`,
    'user-agent': 'teko-ingest',
    'x-github-api-version': '2022-11-28',
    ...extra,
  })

  async function request(
    method: string,
    url: string,
    init: { body?: Uint8Array | string; headers?: Record<string, string>; ok?: number[] } = {},
  ): Promise<Response> {
    const path = url.replace(/^https:\/\/[^/]+/, '')
    for (let attempt = 1; ; attempt += 1) {
      const response = await doFetch(url, {
        method,
        headers: headers(init.headers),
        redirect: 'follow',
        ...(init.body === undefined ? {} : { body: init.body }),
      })
      const accepted = init.ok ?? [200, 201, 204]
      if (accepted.includes(response.status)) {
        return response
      }
      if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
        await response.body?.cancel()
        continue
      }
      await response.body?.cancel()
      throw new GithubReleasesError(`${method} ${path}: HTTP ${String(response.status)}`)
    }
  }

  async function listAssets(releaseId: number): Promise<Map<string, AssetInfo>> {
    const assets = new Map<string, AssetInfo>()
    for (let page = 1; ; page += 1) {
      const url = `${apiUrl}${repoPath}/releases/${String(releaseId)}/assets?per_page=${String(PAGE_SIZE)}&page=${String(page)}`
      const body = parseJson(await (await request('GET', url)).text(), 'lista de assets')
      if (!Array.isArray(body)) {
        throw new GithubReleasesError('lista de assets não é um array')
      }
      for (const item of body) {
        const asset = assetFrom(item)
        assets.set(asset.name, asset)
      }
      if (body.length < PAGE_SIZE) {
        return assets
      }
    }
  }

  async function loadRelease(tag: string): Promise<ReleaseState | null> {
    if (releases.has(tag)) {
      return releases.get(tag) ?? null
    }
    const response = await request(
      'GET',
      `${apiUrl}${repoPath}/releases/tags/${encodeURIComponent(tag)}`,
      { ok: [200, 404] },
    )
    if (response.status === 404) {
      await response.body?.cancel()
      releases.set(tag, null)
      return null
    }
    const id = field(parseJson(await response.text(), `release ${tag}`), 'id')
    if (typeof id !== 'number') {
      throw new GithubReleasesError(`release ${tag} sem id`)
    }
    const state: ReleaseState = { id, tag, assets: await listAssets(id) }
    releases.set(tag, state)
    return state
  }

  async function ensureRelease(tag: string): Promise<ReleaseState> {
    const existing = await loadRelease(tag)
    if (existing !== null) {
      return existing
    }
    const response = await request('POST', `${apiUrl}${repoPath}/releases`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body: RELEASE_BODY,
        draft: false,
        prerelease: true,
        make_latest: 'false',
      }),
      // 422: outra execução criou o release entre a leitura e a criação.
      ok: [201, 422],
    })
    if (response.status === 422) {
      await response.body?.cancel()
      releases.delete(tag)
      const created = await loadRelease(tag)
      if (created === null) {
        throw new GithubReleasesError(`POST /releases (${tag}): HTTP 422 e o release não existe`)
      }
      return created
    }
    const id = field(parseJson(await response.text(), `release ${tag}`), 'id')
    if (typeof id !== 'number') {
      throw new GithubReleasesError(`release ${tag} criado sem id`)
    }
    const state: ReleaseState = { id, tag, assets: new Map() }
    releases.set(tag, state)
    if (SNAPSHOT_TAG.test(tag) && snapshotTags !== null && !snapshotTags.includes(tag)) {
      snapshotTags.push(tag)
    }
    return state
  }

  async function deleteAsset(release: ReleaseState, asset: AssetInfo): Promise<void> {
    await request('DELETE', `${apiUrl}${repoPath}/releases/assets/${String(asset.id)}`, {
      ok: [204, 404],
    })
    release.assets.delete(asset.name)
  }

  async function deleteRelease(release: ReleaseState): Promise<void> {
    await request('DELETE', `${apiUrl}${repoPath}/releases/${String(release.id)}`, {
      ok: [204, 404],
    })
    // Apagar o release deixa a tag; sem ela, a próxima criação da mesma versão começa limpa.
    await request(
      'DELETE',
      `${apiUrl}${repoPath}/git/refs/tags/${encodeURIComponent(release.tag)}`,
      { ok: [204, 404, 422] },
    )
    releases.set(release.tag, null)
    snapshotTags = snapshotTags?.filter((tag) => tag !== release.tag) ?? null
  }

  async function upload(release: ReleaseState, name: string, bytes: Uint8Array): Promise<void> {
    if (release.assets.size >= RELEASE_ASSET_LIMIT) {
      throw new GithubReleasesError(
        `o release ${release.tag} chegou a ${String(RELEASE_ASSET_LIMIT)} assets; aumente os shards (com migração)`,
      )
    }
    const url = `${uploadsUrl}${repoPath}/releases/${String(release.id)}/assets?name=${encodeURIComponent(name)}`
    const response = await request('POST', url, {
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
      ok: [201],
    })
    const asset = assetFrom(parseJson(await response.text(), `upload de ${name}`))
    release.assets.set(asset.name, asset)
    if (asset.name !== name) {
      await deleteAsset(release, asset)
      throw new GithubReleasesError(`o GitHub renomeou o asset ${name} para ${asset.name}`)
    }
    const expected = sha256Hex(bytes)
    if (asset.size !== bytes.byteLength || (asset.sha256 !== null && asset.sha256 !== expected)) {
      await deleteAsset(release, asset)
      throw new GithubReleasesError(`o asset ${name} chegou ao GitHub com conteúdo diferente`)
    }
    release.assets.set(name, { ...asset, sha256: expected })
  }

  async function download(asset: AssetInfo, tag: string): Promise<Uint8Array> {
    const response = await request(
      'GET',
      `${apiUrl}${repoPath}/releases/assets/${String(asset.id)}`,
      { headers: { accept: 'application/octet-stream' } },
    )
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (
      bytes.byteLength !== asset.size ||
      (asset.sha256 !== null && sha256Hex(bytes) !== asset.sha256)
    ) {
      throw new GithubReleasesError(`o asset ${asset.name} de ${tag} não confere com o digest`)
    }
    return bytes
  }

  async function snapshotReleaseTags(): Promise<string[]> {
    if (snapshotTags !== null) {
      return snapshotTags
    }
    const tags: string[] = []
    for (let page = 1; ; page += 1) {
      const url = `${apiUrl}${repoPath}/releases?per_page=${String(PAGE_SIZE)}&page=${String(page)}`
      const body = parseJson(await (await request('GET', url)).text(), 'lista de releases')
      if (!Array.isArray(body)) {
        throw new GithubReleasesError('lista de releases não é um array')
      }
      for (const item of body) {
        const tag = field(item, 'tag_name')
        if (typeof tag === 'string' && SNAPSHOT_TAG.test(tag)) {
          tags.push(tag)
        }
      }
      if (body.length < PAGE_SIZE) {
        snapshotTags = tags
        return tags
      }
    }
  }

  async function lookup(
    store: BlobStoreName,
    key: string,
  ): Promise<{ release: ReleaseState; asset: AssetInfo } | null> {
    const { tag, name } = assetLocation(store, key)
    const release = await loadRelease(tag)
    const asset = release?.assets.get(name)
    return release === null || asset === undefined ? null : { release, asset }
  }

  return {
    async get(store, key) {
      const found = await lookup(store, key)
      return found === null ? null : download(found.asset, found.release.tag)
    },

    async set(store, key, data) {
      const { tag, name } = assetLocation(store, key)
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
      const release = await ensureRelease(tag)
      const existing = release.assets.get(name)
      if (existing !== undefined) {
        if (existing.sha256 === sha256Hex(bytes) && existing.size === bytes.byteLength) {
          return
        }
        await deleteAsset(release, existing)
      }
      await upload(release, name, bytes)
    },

    async list(store, prefix = '') {
      const tags =
        store === BlobStoreName.CorpusSnapshots ? await snapshotReleaseTags() : shardTags(store)
      const keys: string[] = []
      for (const tag of tags) {
        const release = await loadRelease(tag)
        for (const name of release?.assets.keys() ?? []) {
          const key = keyOf(store, tag, name)
          if (key.startsWith(prefix)) {
            keys.push(key)
          }
        }
      }
      return keys.sort(compareCodeUnits)
    },

    async delete(store, key) {
      const found = await lookup(store, key)
      if (found === null) {
        return
      }
      await deleteAsset(found.release, found.asset)
      if (store === BlobStoreName.CorpusSnapshots && found.release.assets.size === 0) {
        await deleteRelease(found.release)
      }
    },

    async sha256Of(store, key) {
      const found = await lookup(store, key)
      if (found === null) {
        return null
      }
      return found.asset.sha256 ?? sha256Hex(await download(found.asset, found.release.tag))
    },
  }
}
