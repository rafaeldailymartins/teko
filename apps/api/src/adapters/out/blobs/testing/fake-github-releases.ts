import { createHash } from 'node:crypto'

/**
 * GitHub de mentira para os testes do `GithubReleasesBlobStore` e da migração: implementa só os
 * endpoints de releases que o adapter usa, em memória, com paginação, `digest` dos assets e o 422
 * de nome repetido. Cada requisição fica em `requests` (método, caminho e headers).
 */

interface FakeAsset {
  id: number
  name: string
  bytes: Uint8Array
  /** `false` simula um asset ainda sem `digest` calculado pelo GitHub. */
  withDigest: boolean
}

interface FakeRelease {
  id: number
  tag: string
  prerelease: boolean
  makeLatest: unknown
  assets: FakeAsset[]
}

interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly headers: Readonly<Record<string, string>>
}

export interface FakeGithub {
  readonly fetch: typeof fetch
  readonly requests: RecordedRequest[]
  readonly releases: Map<string, FakeRelease>
  readonly deletedTags: string[]
  /** Respostas forçadas por ordem de chegada (status) para um método e um trecho do caminho. */
  failNext(method: string, pathFragment: string, status: number): void
  /** Corrompe o digest que o upload devolve (o GitHub "recebeu" outra coisa). */
  corruptNextUploadDigest(): void
  seedRelease(tag: string): FakeRelease
  seedAsset(tag: string, name: string, bytes: Uint8Array, withDigest?: boolean): FakeAsset
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createFakeGithub(repository = 'dono/repo'): FakeGithub {
  const releases = new Map<string, FakeRelease>()
  const requests: RecordedRequest[] = []
  const deletedTags: string[] = []
  const failures: { method: string; fragment: string; status: number }[] = []
  let corruptDigest = false
  let nextId = 1

  const assetJson = (asset: FakeAsset, digest?: string) => ({
    id: asset.id,
    name: asset.name,
    size: asset.bytes.byteLength,
    state: 'uploaded',
    digest: asset.withDigest ? (digest ?? `sha256:${sha256(asset.bytes)}`) : null,
  })

  const releaseById = (id: number): FakeRelease | undefined =>
    [...releases.values()].find((release) => release.id === id)

  const seedRelease = (tag: string): FakeRelease => {
    const release: FakeRelease = {
      id: nextId++,
      tag,
      prerelease: true,
      makeLatest: 'false',
      assets: [],
    }
    releases.set(tag, release)
    return release
  }

  const seedAsset = (tag: string, name: string, bytes: Uint8Array, withDigest = true) => {
    const release = releases.get(tag) ?? seedRelease(tag)
    const asset = { id: nextId++, name, bytes: new Uint8Array(bytes), withDigest }
    release.assets.push(asset)
    return asset
  }

  const page = <T>(items: readonly T[], url: URL): T[] => {
    const perPage = Number(url.searchParams.get('per_page') ?? '30')
    const pageNumber = Number(url.searchParams.get('page') ?? '1')
    return items.slice((pageNumber - 1) * perPage, pageNumber * perPage)
  }

  type Handler = (param: string, url: URL, body: Uint8Array | null) => Response

  const getReleaseByTag: Handler = (tag) => {
    const release = releases.get(decodeURIComponent(tag))
    return release === undefined
      ? json(404, { message: 'Not Found' })
      : json(200, { id: release.id, tag_name: release.tag })
  }

  const listReleases: Handler = (_param, url) =>
    json(
      200,
      page(
        [...releases.values()].map((release) => ({ id: release.id, tag_name: release.tag })),
        url,
      ),
    )

  const createRelease: Handler = (_param, _url, body) => {
    const payload = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array())) as {
      tag_name: string
      prerelease?: boolean
      make_latest?: unknown
    }
    if (releases.has(payload.tag_name)) {
      return json(422, { message: 'Validation Failed' })
    }
    const release = seedRelease(payload.tag_name)
    release.prerelease = payload.prerelease === true
    release.makeLatest = payload.make_latest
    return json(201, { id: release.id, tag_name: release.tag })
  }

  const listAssets: Handler = (id, url) => {
    const release = releaseById(Number(id))
    return release === undefined
      ? json(404, {})
      : json(
          200,
          page(
            release.assets.map((asset) => assetJson(asset)),
            url,
          ),
        )
  }

  const uploadAsset: Handler = (id, url, body) => {
    const release = releaseById(Number(id))
    const name = url.searchParams.get('name') ?? ''
    if (release === undefined) {
      return json(404, {})
    }
    if (release.assets.some((asset) => asset.name === name)) {
      return json(422, { message: 'already_exists' })
    }
    const asset = seedAsset(release.tag, name, body ?? new Uint8Array())
    const digest = corruptDigest ? `sha256:${'0'.repeat(64)}` : undefined
    corruptDigest = false
    return json(201, assetJson(asset, digest))
  }

  const assetById = (id: string): { release: FakeRelease; index: number } | null => {
    for (const release of releases.values()) {
      const index = release.assets.findIndex((asset) => asset.id === Number(id))
      if (index >= 0) {
        return { release, index }
      }
    }
    return null
  }

  const downloadAsset: Handler = (id) => {
    const found = assetById(id)
    const asset = found?.release.assets[found.index]
    return asset === undefined ? json(404, {}) : new Response(new Uint8Array(asset.bytes))
  }

  const deleteAsset: Handler = (id) => {
    const found = assetById(id)
    found?.release.assets.splice(found.index, 1)
    return new Response(null, { status: found === null ? 404 : 204 })
  }

  const deleteRelease: Handler = (id) => {
    const release = releaseById(Number(id))
    if (release !== undefined) {
      releases.delete(release.tag)
    }
    return new Response(null, { status: release === undefined ? 404 : 204 })
  }

  const deleteTag: Handler = (tag) => {
    deletedTags.push(decodeURIComponent(tag))
    return new Response(null, { status: 204 })
  }

  const routes: readonly (readonly [string, RegExp, Handler])[] = [
    ['GET', /^\/releases\/tags\/(.+)$/, getReleaseByTag],
    ['GET', /^\/releases()$/, listReleases],
    ['POST', /^\/releases()$/, createRelease],
    ['GET', /^\/releases\/(\d+)\/assets$/, listAssets],
    ['POST', /^\/releases\/(\d+)\/assets$/, uploadAsset],
    ['GET', /^\/releases\/assets\/(\d+)$/, downloadAsset],
    ['DELETE', /^\/releases\/assets\/(\d+)$/, deleteAsset],
    ['DELETE', /^\/releases\/(\d+)$/, deleteRelease],
    ['DELETE', /^\/git\/refs\/tags\/(.+)$/, deleteTag],
  ]

  const handle = (method: string, url: URL, body: Uint8Array | null): Response => {
    const prefix = `/repos/${repository}`
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ''
    for (const [routeMethod, pattern, handler] of routes) {
      const match = routeMethod === method ? pattern.exec(path) : null
      if (match !== null) {
        return handler(match[1] ?? '', url, body)
      }
    }
    return json(404, { message: `rota desconhecida no fake: ${method} ${url.pathname}` })
  }

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    const method = init?.method ?? 'GET'
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    requests.push({ method, path: `${url.hostname}${url.pathname}`, headers })
    const failure = failures.findIndex(
      (entry) => entry.method === method && url.pathname.includes(entry.fragment),
    )
    if (failure >= 0) {
      const [entry] = failures.splice(failure, 1)
      return json(entry?.status ?? 500, { message: 'falha forçada' })
    }
    const raw = init?.body
    const body =
      raw === undefined || raw === null
        ? null
        : typeof raw === 'string'
          ? new TextEncoder().encode(raw)
          : new Uint8Array(raw as Uint8Array)
    return handle(method, url, body)
  }

  return {
    fetch: fakeFetch as typeof fetch,
    requests,
    releases,
    deletedTags,
    failNext: (method, fragment, status) => {
      failures.push({ method, fragment, status })
    },
    corruptNextUploadDigest: () => {
      corruptDigest = true
    },
    seedRelease,
    seedAsset,
  }
}
