import { describe, expect, it } from 'vitest'
import { createGithubReleasesBlobStore } from '#adapters/out/blobs/github-releases-blob-store.ts'
import { createFakeGithub } from '#adapters/out/blobs/testing/fake-github-releases.ts'
import { createInMemoryBlobStore } from '#adapters/out/fakes/in-memory-blob-store.ts'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import { CliUsageError } from '../ingest/cli-common.ts'
import { runBlobsMigrate } from './run-blobs-migrate.ts'

const SHA = 'b'.repeat(64)

async function seededSource(): Promise<BlobStore> {
  const source = createInMemoryBlobStore()
  await source.set(BlobStoreName.CorpusRaw, `rcte/rcte-go/2026-11-06/${SHA}.htm`, '<html/>')
  await source.set(BlobStoreName.CorpusDocling, `efd/guia/3.2.4/${SHA}-p1-125.json`, '{"a":1}')
  await source.set(BlobStoreName.CorpusSnapshots, 'snapshots/11/manifest.json', '{"v":11}')
  await source.set(BlobStoreName.CorpusSnapshots, 'snapshots/11/chunks.jsonl.zst', 'zst')
  await source.set(BlobStoreName.CorpusManifests, 'watch-state.json', '{"pages":{}}')
  await source.set(BlobStoreName.CorpusManifests, 'discovered/2026-11-12.json', '{}')
  return source
}

function setup(source: BlobStore) {
  const github = createFakeGithub()
  const target = createGithubReleasesBlobStore({
    repository: 'dono/repo',
    token: 'ghs_tokenDeTesteDaMigracao',
    fetch: github.fetch,
  })
  const lines: string[] = []
  const deps = { source, target, print: (line: string) => lines.push(line) }
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>)
  return { github, target, deps, lines, parsed }
}

describe('runBlobsMigrate', () => {
  it('copia todos os stores conferindo o sha256 e, rodando de novo, pula tudo', async () => {
    const source = await seededSource()
    const { target, deps, lines, parsed } = setup(source)

    expect(await runBlobsMigrate(deps, [])).toBe(0)
    expect(parsed().at(-1)).toEqual({
      dryRun: false,
      stores: 5,
      total: 6,
      copied: 6,
      skipped: 0,
      failed: 0,
    })
    expect(parsed()[0]).toMatchObject({ store: 'corpus-raw', total: 1, copied: 1 })
    for (const store of Object.values(BlobStoreName)) {
      const keys = await source.list(store)
      expect(await target.list(store)).toEqual(keys)
      for (const key of keys) {
        expect(await target.get(store, key)).toEqual(await source.get(store, key))
      }
    }

    lines.length = 0
    expect(await runBlobsMigrate(deps, [])).toBe(0)
    expect(parsed().at(-1)).toMatchObject({ copied: 0, skipped: 6, failed: 0 })
  })

  it('troca no destino o que diverge da origem', async () => {
    const source = await seededSource()
    const { target, deps, parsed } = setup(source)
    await target.set(BlobStoreName.CorpusManifests, 'watch-state.json', '{"velho":true}')
    expect(await runBlobsMigrate(deps, ['--store', 'corpus-manifests'])).toBe(0)
    expect(parsed()).toHaveLength(2)
    expect(parsed()[0]).toMatchObject({ store: 'corpus-manifests', copied: 2, skipped: 0 })
    const bytes = await target.get(BlobStoreName.CorpusManifests, 'watch-state.json')
    expect(new TextDecoder().decode(bytes ?? undefined)).toBe('{"pages":{}}')
  })

  it('--dry-run só conta, sem gravar', async () => {
    const source = await seededSource()
    const { github, deps, parsed } = setup(source)
    expect(await runBlobsMigrate(deps, ['--dry-run'])).toBe(0)
    expect(parsed().at(-1)).toMatchObject({ dryRun: true, copied: 6 })
    expect(github.requests.filter((request) => request.method !== 'GET')).toEqual([])
  })

  it('chave que o GitHub Releases não representa falha sozinha (código 1)', async () => {
    const source = await seededSource()
    await source.set(BlobStoreName.CorpusRaw, 'chave__com__separador.pdf', 'x')
    const { deps, parsed } = setup(source)
    expect(await runBlobsMigrate(deps, ['--store', 'corpus-raw'])).toBe(1)
    expect(parsed()[0]).toMatchObject({
      store: 'corpus-raw',
      total: 2,
      copied: 1,
      failed: [
        { key: 'chave__com__separador.pdf', error: expect.stringMatching(/GithubReleasesError/) },
      ],
    })
  })

  it('chave listada que some na leitura entra como falha', async () => {
    const source = await seededSource()
    const flaky: BlobStore = { ...source, get: () => Promise.resolve(null) }
    const { deps, parsed } = setup(flaky)
    expect(await runBlobsMigrate(deps, ['--store', 'corpus-snapshots'])).toBe(1)
    const missing = { error: expect.stringMatching(/ausente na leitura/) }
    expect(parsed()[0]).toMatchObject({ total: 2, copied: 0, failed: [missing, missing] })
  })

  it('recusa store desconhecido e argumento solto (uso)', async () => {
    const { deps } = setup(createInMemoryBlobStore())
    await expect(runBlobsMigrate(deps, ['--store', 'outro'])).rejects.toBeInstanceOf(CliUsageError)
    await expect(runBlobsMigrate(deps, ['posicional'])).rejects.toBeInstanceOf(CliUsageError)
  })
})
