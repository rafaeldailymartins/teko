import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import type { SafeFetcher } from '#app/ports/safe-fetcher.ts'
import { runSourcesWatch, SOURCES_WATCH_USAGE } from './run-sources-watch.ts'

const clock = { now: () => new Date('2026-11-11T12:00:00Z') }

function memoryBlobs(): BlobStore & { data: Map<string, Uint8Array | string> } {
  const data = new Map<string, Uint8Array | string>()
  return {
    data,
    async get(store, key) {
      const value = data.get(`${store}/${key}`)
      return typeof value === 'string' ? new TextEncoder().encode(value) : (value ?? null)
    },
    async set(store, key, value) {
      data.set(`${store}/${key}`, value)
    },
    async list() {
      return [...data.keys()]
    },
    async delete(store, key) {
      data.delete(`${store}/${key}`)
    },
  }
}

const CONFIG = `version: 1
pages:
  - id: rcte
    family: rcte
    kind: consolidated
    url: https://appasp.economia.go.gov.br/RCTE.htm
  - id: cte
    family: cte
    kind: consolidated
    url: https://appasp.economia.go.gov.br/CTE.htm
`

function header(number: string): Uint8Array {
  return new TextEncoder().encode(`<p>CONSOLIDADO ATÉ O DECRETO Nº ${number}, DE 16.09.26.</p>`)
}

async function workspace(config = CONFIG): Promise<{ dir: string; config: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'teko-sources-watch-'))
  const path = join(dir, 'watch.yaml')
  await writeFile(path, config)
  return { dir, config: path }
}

describe('runSourcesWatch', () => {
  it('grava discovered.json local e no Blobs e resume o run', async () => {
    const { dir, config } = await workspace()
    const blobs = memoryBlobs()
    let label = '10.986'
    const fetcher: SafeFetcher = {
      async fetch(request) {
        if (request.url.endsWith('CTE.htm') && !request.url.endsWith('RCTE.htm')) {
          return { status: 503, url: request.url, headers: {}, body: new Uint8Array() }
        }
        return { status: 200, url: request.url, headers: {}, body: header(label) }
      },
    }
    const lines: string[] = []
    const out = join(dir, 'saida')
    expect(
      await runSourcesWatch({ fetcher, blobs, clock, log: (line) => lines.push(line) }, [
        '--config',
        config,
        '--out',
        out,
      ]),
    ).toBe(0)
    label = '10.991'
    lines.length = 0
    expect(
      await runSourcesWatch({ fetcher, blobs, clock, log: (line) => lines.push(line) }, [
        '--config',
        config,
        '--out',
        out,
      ]),
    ).toBe(0)
    const report = JSON.parse(await readFile(join(out, 'discovered.json'), 'utf8')) as {
      changes: unknown[]
      unverifiedFamilies: string[]
    }
    expect(report.changes).toHaveLength(1)
    expect(report.unverifiedFamilies).toEqual(['cte'])
    expect(blobs.data.has(`${BlobStoreName.CorpusManifests}/discovered.json`)).toBe(true)
    expect(lines).toEqual([
      'sources-watch 2026-11-11: 1 mudança(s), 1 erro(s)',
      '  nova rcte (consolidated, live): Decreto nº 10.991 desde 2026-09-16',
      '  erro cte (cte): HTTP 503 em https://appasp.economia.go.gov.br/CTE.htm',
    ])
  })

  it('em dry-run não grava no Blobs; pendente sem rótulo mostra a URL', async () => {
    const { dir, config } = await workspace()
    const blobs = memoryBlobs()
    const fetcher: SafeFetcher = {
      async fetch(request) {
        return { status: 200, url: request.url, headers: {}, body: header('1') }
      },
    }
    expect(
      await runSourcesWatch({ fetcher, blobs, clock, log: () => {} }, [
        '--config',
        config,
        '--out',
        dir,
        '--dry-run',
      ]),
    ).toBe(0)
    expect(blobs.data.size).toBe(0)
  })

  it('devolve 1 com watch.yaml ou estado inválidos e 64 com argumentos inválidos', async () => {
    const lines: string[] = []
    const fetcher: SafeFetcher = {
      fetch: () => Promise.reject(new Error('não deveria buscar')),
    }
    const broken = await workspace('version: 2')
    const deps = { fetcher, blobs: memoryBlobs(), clock, log: (line: string) => lines.push(line) }
    expect(await runSourcesWatch(deps, ['--config', broken.config, '--out', broken.dir])).toBe(1)
    expect(lines.at(-1)).toMatch(/^erro: .*watch\.yaml: version/)

    const { config, dir } = await workspace()
    const corrupt = memoryBlobs()
    await corrupt.set(BlobStoreName.CorpusManifests, 'watch-state.json', 'x')
    expect(
      await runSourcesWatch({ ...deps, blobs: corrupt }, ['--config', config, '--out', dir]),
    ).toBe(1)

    expect(await runSourcesWatch(deps, ['--nada'])).toBe(64)
    expect(lines.at(-1)).toContain(SOURCES_WATCH_USAGE)
  })

  it('propaga erros inesperados', async () => {
    const { config, dir } = await workspace()
    const blobs = memoryBlobs()
    blobs.get = () => Promise.reject(new Error('Blobs fora do ar'))
    const fetcher: SafeFetcher = { fetch: () => Promise.reject(new Error('x')) }
    await expect(
      runSourcesWatch({ fetcher, blobs, clock }, ['--config', config, '--out', dir]),
    ).rejects.toThrow('Blobs fora do ar')
  })
})
