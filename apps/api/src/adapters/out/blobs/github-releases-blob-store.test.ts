import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import {
  assetLocation,
  createGithubReleasesBlobStore,
  GithubReleasesError,
  RELEASE_ASSET_LIMIT,
  SHARDED_STORES,
} from './github-releases-blob-store.ts'
import { createFakeGithub } from './testing/fake-github-releases.ts'

const TOKEN = 'ghs_tokenDeTesteQueNuncaApareceEmErros'
const SHA = 'a'.repeat(64)
const RAW_KEY = `rcte/rcte-go/2026-11-06/${SHA}.htm`

function setup() {
  const github = createFakeGithub()
  const blobs = createGithubReleasesBlobStore({
    repository: 'dono/repo',
    token: TOKEN,
    fetch: github.fetch,
  })
  return { github, blobs }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const text = (value: string): Uint8Array => new TextEncoder().encode(value)

describe('assetLocation', () => {
  it('snapshot: release corpus-v<N> e o nome do arquivo', () => {
    expect(assetLocation(BlobStoreName.CorpusSnapshots, 'snapshots/11/manifest.json')).toEqual({
      tag: 'corpus-v11',
      name: 'manifest.json',
    })
    expect(
      assetLocation(BlobStoreName.CorpusSnapshots, 'snapshots/007/chunk_sources.jsonl.zst'),
    ).toEqual({ tag: 'corpus-v7', name: 'chunk_sources.jsonl.zst' })
  })

  it('demais stores: shard determinístico pelo sha256 da chave e "/" trocado por "__"', () => {
    const location = assetLocation(BlobStoreName.CorpusRaw, RAW_KEY)
    expect(location.name).toBe(`rcte__rcte-go__2026-11-06__${SHA}.htm`)
    expect(location.tag).toMatch(/^corpus-raw-[0-9a-f]$/)
    expect(assetLocation(BlobStoreName.CorpusRaw, RAW_KEY)).toEqual(location)
    expect(assetLocation(BlobStoreName.CorpusManifests, 'watch-state.json').tag).toMatch(
      /^corpus-watch-state-[0-3]$/,
    )
    expect(assetLocation(BlobStoreName.EvalArtifacts, 'history/11.json').tag).toMatch(
      /^corpus-eval-history-[0-3]$/,
    )
    expect(assetLocation(BlobStoreName.CorpusDocling, `${SHA}-p1-125.json`).tag).toMatch(
      /^corpus-docling-[0-9a-f]$/,
    )
  })

  it('espalha as chaves pelos shards', () => {
    const tags = new Set(
      Array.from(
        { length: 200 },
        (_, index) => assetLocation(BlobStoreName.CorpusRaw, `f/d/v/${String(index)}.pdf`).tag,
      ),
    )
    expect(tags.size).toBe(SHARDED_STORES[BlobStoreName.CorpusRaw].shards)
  })

  it.each(['a/../b', 'a__b', '/absoluta', 'com espaço', '', 'ç/acento'])(
    'recusa a chave %j',
    (key) => {
      expect(() => assetLocation(BlobStoreName.CorpusRaw, key)).toThrow(GithubReleasesError)
    },
  )

  it('recusa chave longa demais e snapshot fora do formato', () => {
    expect(() => assetLocation(BlobStoreName.CorpusRaw, `a/${'b'.repeat(260)}`)).toThrow(
      /caracteres \(máximo 255\)/,
    )
    expect(() => assetLocation(BlobStoreName.CorpusSnapshots, 'snapshots/x/manifest.json')).toThrow(
      /snapshots\/<versão>\/<arquivo>/,
    )
  })
})

describe('createGithubReleasesBlobStore', () => {
  it('valida repositório e token', () => {
    expect(() => createGithubReleasesBlobStore({ repository: 'sem-barra', token: TOKEN })).toThrow(
      /owner\/repo/,
    )
    expect(() => createGithubReleasesBlobStore({ repository: 'dono/repo', token: ' ' })).toThrow(
      /GITHUB_TOKEN/,
    )
  })

  it('cria o release como prerelease fora do latest, grava, lê e lista', async () => {
    const { github, blobs } = setup()
    await blobs.set(BlobStoreName.CorpusRaw, RAW_KEY, text('<html>RCTE</html>'))
    await blobs.set(BlobStoreName.CorpusManifests, 'watch-state.json', '{"pages":{}}')

    const { tag } = assetLocation(BlobStoreName.CorpusRaw, RAW_KEY)
    expect(github.releases.get(tag)).toMatchObject({ prerelease: true, makeLatest: 'false' })
    expect(
      new TextDecoder().decode((await blobs.get(BlobStoreName.CorpusRaw, RAW_KEY)) ?? undefined),
    ).toBe('<html>RCTE</html>')
    expect(await blobs.list(BlobStoreName.CorpusRaw)).toEqual([RAW_KEY])
    expect(await blobs.list(BlobStoreName.CorpusRaw, 'rcte/')).toEqual([RAW_KEY])
    expect(await blobs.list(BlobStoreName.CorpusRaw, 'cte/')).toEqual([])
    expect(await blobs.list(BlobStoreName.CorpusManifests)).toEqual(['watch-state.json'])
    expect(await blobs.get(BlobStoreName.CorpusRaw, `x/y/z/${SHA}.pdf`)).toBeNull()
    expect(await blobs.get(BlobStoreName.CorpusDocling, `x/${SHA}.json`)).toBeNull()

    const auth = github.requests.map((request) => request.headers['authorization'])
    expect(new Set(auth)).toEqual(new Set([`Bearer ${TOKEN}`]))
    expect(github.requests.some((request) => request.path.startsWith('uploads.github.com/'))).toBe(
      true,
    )
  })

  it('lista em ordem lexicográfica juntando shards', async () => {
    const { blobs } = setup()
    const keys = ['b/2.json', 'a/1.json', 'c/3.json', 'a/0.json']
    for (const key of keys) {
      await blobs.set(BlobStoreName.CorpusDocling, key, key)
    }
    expect(await blobs.list(BlobStoreName.CorpusDocling)).toEqual([...keys].sort())
    expect(await blobs.list(BlobStoreName.CorpusDocling, 'a/')).toEqual(['a/0.json', 'a/1.json'])
  })

  it('set com o mesmo conteúdo não sobe de novo; com outro, troca o asset', async () => {
    const { github, blobs } = setup()
    await blobs.set(BlobStoreName.CorpusManifests, 'watch-state.json', 'v1')
    const uploads = () => github.requests.filter((r) => r.path.startsWith('uploads.')).length
    expect(uploads()).toBe(1)
    await blobs.set(BlobStoreName.CorpusManifests, 'watch-state.json', 'v1')
    expect(uploads()).toBe(1)
    await blobs.set(BlobStoreName.CorpusManifests, 'watch-state.json', 'v2')
    expect(uploads()).toBe(2)
    expect(github.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1)
    const bytes = await blobs.get(BlobStoreName.CorpusManifests, 'watch-state.json')
    expect(new TextDecoder().decode(bytes ?? undefined)).toBe('v2')
  })

  it('snapshots: um release por versão; apagar o último asset apaga o release e a tag', async () => {
    const { github, blobs } = setup()
    await blobs.set(BlobStoreName.CorpusSnapshots, 'snapshots/10/manifest.json', '{}')
    await blobs.set(BlobStoreName.CorpusSnapshots, 'snapshots/10/chunks.jsonl.zst', text('z'))
    await blobs.set(BlobStoreName.CorpusSnapshots, 'snapshots/11/manifest.json', '{"v":11}')
    expect(await blobs.list(BlobStoreName.CorpusSnapshots, 'snapshots/')).toEqual([
      'snapshots/10/chunks.jsonl.zst',
      'snapshots/10/manifest.json',
      'snapshots/11/manifest.json',
    ])
    await blobs.delete(BlobStoreName.CorpusSnapshots, 'snapshots/10/manifest.json')
    expect(github.releases.has('corpus-v10')).toBe(true)
    await blobs.delete(BlobStoreName.CorpusSnapshots, 'snapshots/10/chunks.jsonl.zst')
    expect(github.releases.has('corpus-v10')).toBe(false)
    expect(github.deletedTags).toEqual(['corpus-v10'])
    expect(await blobs.list(BlobStoreName.CorpusSnapshots)).toEqual(['snapshots/11/manifest.json'])
    // Apagar o que não existe não faz nada.
    await blobs.delete(BlobStoreName.CorpusSnapshots, 'snapshots/10/manifest.json')
  })

  it('lista os snapshots de um repositório já povoado (paginação de releases e de assets)', async () => {
    const { github, blobs } = setup()
    for (let version = 1; version <= 120; version += 1) {
      github.seedRelease(`outro-${String(version)}`)
    }
    for (let index = 0; index < 150; index += 1) {
      github.seedAsset('corpus-v3', `t${String(index).padStart(3, '0')}.jsonl.zst`, text('x'))
    }
    const keys = await blobs.list(BlobStoreName.CorpusSnapshots)
    expect(keys).toHaveLength(150)
    expect(keys[0]).toBe('snapshots/3/t000.jsonl.zst')
  })

  it('o release criado por outra execução no meio do caminho é reaproveitado (422)', async () => {
    const { github, blobs } = setup()
    const { tag } = assetLocation(BlobStoreName.CorpusManifests, 'discovered.json')
    // A leitura vê 404; antes do POST, outra execução cria o release.
    await blobs.get(BlobStoreName.CorpusManifests, 'discovered.json')
    github.seedRelease(tag)
    await blobs.set(BlobStoreName.CorpusManifests, 'discovered.json', '{}')
    expect(await blobs.list(BlobStoreName.CorpusManifests)).toEqual(['discovered.json'])
  })

  it('repete erros 5xx e desiste depois de 3 tentativas, sem o token na mensagem', async () => {
    const { github, blobs } = setup()
    github.failNext('POST', '/releases', 502)
    await blobs.set(BlobStoreName.CorpusRaw, RAW_KEY, 'ok')
    expect(await blobs.list(BlobStoreName.CorpusRaw)).toEqual([RAW_KEY])

    for (let attempt = 0; attempt < 3; attempt += 1) {
      github.failNext('GET', '/releases/tags/', 503)
    }
    const other = createGithubReleasesBlobStore({
      repository: 'dono/repo',
      token: TOKEN,
      fetch: github.fetch,
    })
    const error = await other.get(BlobStoreName.CorpusRaw, RAW_KEY).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GithubReleasesError)
    expect(String(error)).toMatch(/GET \/repos\/dono\/repo\/releases\/tags\/corpus-raw-.*HTTP 503/)
    expect(String(error)).not.toContain(TOKEN)
  })

  it('recusa download que não confere com o digest', async () => {
    const { github, blobs } = setup()
    await blobs.set(BlobStoreName.CorpusRaw, RAW_KEY, 'original')
    const { tag, name } = assetLocation(BlobStoreName.CorpusRaw, RAW_KEY)
    const asset = github.releases.get(tag)?.assets.find((item) => item.name === name)
    if (asset === undefined) {
      throw new Error('asset ausente no fake')
    }
    asset.bytes = text('adulterado')
    const fresh = createGithubReleasesBlobStore({
      repository: 'dono/repo',
      token: TOKEN,
      fetch: github.fetch,
    })
    // O digest listado é o do conteúdo atual no fake; o tamanho cacheado pelo `blobs` é o antigo.
    await expect(blobs.get(BlobStoreName.CorpusRaw, RAW_KEY)).rejects.toThrow(/digest/)
    expect(
      new TextDecoder().decode((await fresh.get(BlobStoreName.CorpusRaw, RAW_KEY)) ?? undefined),
    ).toBe('adulterado')
  })

  it('upload que chega com outro digest é apagado e falha', async () => {
    const { github, blobs } = setup()
    github.corruptNextUploadDigest()
    await expect(blobs.set(BlobStoreName.CorpusRaw, RAW_KEY, 'x')).rejects.toThrow(
      /conteúdo diferente/,
    )
    const { tag } = assetLocation(BlobStoreName.CorpusRaw, RAW_KEY)
    expect(github.releases.get(tag)?.assets).toEqual([])
  })

  it(`recusa gravar num release com ${String(RELEASE_ASSET_LIMIT)} assets`, async () => {
    const { github, blobs } = setup()
    const { tag } = assetLocation(BlobStoreName.CorpusManifests, 'watch-state.json')
    for (let index = 0; index < RELEASE_ASSET_LIMIT; index += 1) {
      github.seedAsset(tag, `seed-${String(index)}.json`, text('{}'))
    }
    await expect(
      blobs.set(BlobStoreName.CorpusManifests, 'watch-state.json', '{}'),
    ).rejects.toThrow(/aumente os shards/)
  })

  it('sha256Of usa o digest do GitHub e, sem ele, baixa e calcula', async () => {
    const { github, blobs } = setup()
    const bytes = text('conteúdo')
    await blobs.set(BlobStoreName.CorpusRaw, RAW_KEY, bytes)
    expect(await blobs.sha256Of(BlobStoreName.CorpusRaw, RAW_KEY)).toBe(sha256(bytes))
    expect(await blobs.sha256Of(BlobStoreName.CorpusRaw, `n/a/v/${SHA}.pdf`)).toBeNull()

    const key = 'sem/digest.json'
    const { tag, name } = assetLocation(BlobStoreName.CorpusDocling, key)
    github.seedAsset(tag, name, text('{"a":1}'), false)
    const fresh = createGithubReleasesBlobStore({
      repository: 'dono/repo',
      token: TOKEN,
      fetch: github.fetch,
    })
    expect(await fresh.sha256Of(BlobStoreName.CorpusDocling, key)).toBe(sha256(text('{"a":1}')))
  })
})
