import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createInMemoryBlobStore,
  type InMemoryBlobStore,
} from '#adapters/out/fakes/in-memory-blob-store.ts'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import { doclingBlobKey, rawBlobKey } from './blob-keys.ts'
import { CliUsageError } from './cli-common.ts'
import { parseDiscoverArgs, runIngestDiscover } from './discover.ts'
import { type ExtractMatrixItem, type Plan, planSchema } from './plan.ts'
import {
  DEFAULT_RESPONSES,
  encode,
  fakeFetcher,
  GO_58_PDF,
  GUIA_PDF,
  sha256,
  TABLE_TXT,
  testCorpusConfig,
  URLS,
} from './testing/corpus-fixture.ts'

let out: string
let blobs: InMemoryBlobStore
let lines: string[]

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'teko-discover-'))
  blobs = createInMemoryBlobStore()
  lines = []
})

function readPlan(): Plan {
  return planSchema.parse(JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8')))
}

function readMatrix(): ExtractMatrixItem[] {
  return JSON.parse(readFileSync(join(out, 'extract-matrix.json'), 'utf8')) as ExtractMatrixItem[]
}

async function discover(args: string[] = [], fetcher = fakeFetcher(), config = testCorpusConfig()) {
  const code = await runIngestDiscover(
    {
      config,
      fetcher,
      blobs,
      print: (line) => lines.push(line),
      now: () => new Date('2026-11-11T12:00:00Z'),
    },
    ['--target', 'staging', '--out', out, ...args],
  )
  return { code, fetcher }
}

describe('ingest discover', () => {
  it('baixa as fontes, grava os arquivos, o plano e a matriz do Docling', async () => {
    const { code, fetcher } = await discover()
    expect(code).toBe(0)
    const plan = readPlan()
    expect(plan).toMatchObject({
      target: 'staging',
      createdAt: '2026-11-11T12:00:00.000Z',
      errors: [],
    })
    expect(plan.items.map((item) => item.sourceId)).toEqual([
      'efd-icms-ipi/guia-pratico/3.2.4',
      'efd-go/guia-pratico/5.9',
      'efd-go/guia-pratico/5.8',
      'rcte/consolidado',
      'tabelas-go/5-5',
      'efd-reinf/leiautes/2.1.2',
    ])
    const guiaSha = sha256(GUIA_PDF)
    const guia = plan.items[0]
    expect(guia).toMatchObject({
      file: `files/${guiaSha}.pdf`,
      origin: 'source',
      bytes: GUIA_PDF.byteLength,
    })
    expect(guia?.docling).toEqual([
      { id: `${guiaSha}-p1-2`, pageRange: '1-2', cached: false },
      { id: `${guiaSha}-p3-4`, pageRange: '3-4', cached: false },
    ])
    expect(readFileSync(join(out, `files/${guiaSha}.pdf`))).toEqual(Buffer.from(GUIA_PDF))
    const table = plan.items.find((item) => item.sourceId === 'tabelas-go/5-5')
    expect(table).toMatchObject({ url: URLS.table40, sha256: sha256(TABLE_TXT), docling: [] })
    expect(table?.externalTable).toMatchObject({ id: 40, versao: 5, dtVersao: '2024-11-04' })
    expect(fetcher.urls.filter((url) => url === URLS.wsVersions)).toHaveLength(1)

    const matrix = readMatrix()
    expect(matrix).toHaveLength(4)
    expect(matrix[0]).toEqual({
      id: `${guiaSha}-p1-2`,
      file: `files/${guiaSha}.pdf`,
      sourceId: 'efd-icms-ipi/guia-pratico/3.2.4',
      url: URLS.guia,
      pageRange: '1-2',
      ocr: false,
      timeoutSeconds: 7200,
    })
    expect(matrix.find((item) => item.sourceId === 'efd-go/guia-pratico/5.8')).toMatchObject({
      pageRange: null,
      ocr: true,
      timeoutSeconds: 3600,
    })
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      discovered: 6,
      fromBlobs: 0,
      doclingParts: 4,
      errors: [],
    })
  })

  it('reaproveita o raw pinned e o docling já gravados no Blobs', async () => {
    const goSha = sha256(GO_58_PDF)
    const parts = {
      family: 'efd-go',
      documentSlug: 'guia-pratico-efd-goias',
      version: '5.8',
      sha256: goSha,
    } as const
    await blobs.set(BlobStoreName.CorpusRaw, rawBlobKey(parts, 'pdf'), GO_58_PDF)
    await blobs.set(BlobStoreName.CorpusDocling, doclingBlobKey(parts, null), '{}')
    // Raw com sha256 errado no Blobs: ignorado, baixa da origem.
    const guiaSha = sha256(GUIA_PDF)
    await blobs.set(
      BlobStoreName.CorpusRaw,
      rawBlobKey(
        {
          family: 'efd-icms-ipi',
          documentSlug: 'guia-pratico-efd-icms-ipi',
          version: '3.2.4',
          sha256: guiaSha,
        },
        'pdf',
      ),
      encode('corrompido'),
    )
    const { fetcher } = await discover()
    expect(fetcher.urls).not.toContain(URLS.go58)
    expect(fetcher.urls).toContain(URLS.guia)
    const go = readPlan().items.find((item) => item.sourceId === 'efd-go/guia-pratico/5.8')
    expect(go).toMatchObject({
      origin: 'blobs',
      docling: [{ id: goSha, pageRange: null, cached: true }],
    })
    expect(readMatrix().some((item) => item.sourceId === 'efd-go/guia-pratico/5.8')).toBe(false)
  })

  it('filtra por família', async () => {
    const { fetcher } = await discover(['--family', 'rcte,tabelas-go'])
    expect(readPlan().items.map((item) => item.sourceId)).toEqual([
      'rcte/consolidado',
      'tabelas-go/5-5',
    ])
    expect(readPlan().families).toEqual(['rcte', 'tabelas-go'])
    expect(fetcher.urls).not.toContain(URLS.guia)
  })

  it('registra pin divergente, HTTP de erro e falha do WS, e sai com 1', async () => {
    const fetcher = fakeFetcher({
      ...DEFAULT_RESPONSES,
      [URLS.rcte]: { status: 503, url: URLS.rcte, headers: {}, body: new Uint8Array() },
      [URLS.wsVersions]: encode('<html>fora do ar</html>'),
    })
    const { code } = await discover([], fetcher, testCorpusConfig({ guiaSha256: '0'.repeat(64) }))
    expect(code).toBe(1)
    const errors = readPlan().errors
    expect(errors.map((error) => error.sourceId)).toEqual([
      'efd-icms-ipi/guia-pratico/3.2.4',
      'rcte/consolidado',
      'tabelas-go/5-5',
    ])
    expect(errors[0]?.message).toMatch(/PinMismatchError: .*diferente do pin 0{64}/)
    expect(errors[1]?.message).toMatch(/HTTP 503/)
    expect(errors[2]?.message).toMatch(/sem codigoRetorno/)
    expect(readPlan().items).toHaveLength(3)
  })

  it('registra o WS que responde com erro HTTP e a tabela ausente', async () => {
    const down = fakeFetcher({
      ...DEFAULT_RESPONSES,
      [URLS.wsVersions]: { status: 500, url: URLS.wsVersions, headers: {}, body: new Uint8Array() },
    })
    expect((await discover(['--family', 'tabelas-go'], down)).code).toBe(1)
    expect(readPlan().errors[0]?.message).toMatch(/HTTP 500/)
    const other = fakeFetcher({
      ...DEFAULT_RESPONSES,
      [URLS.wsVersions]: encode(
        '<codigoRetorno>101</codigoRetorno><metadadosXml>&lt;tabela id="41" desc="x" versao="1" dtVersao="2024-01-01" hash="C73DE89E26DBF1A081B86D0B76819AF0131392C9"/&gt;</metadadosXml>',
      ),
    })
    expect((await discover(['--family', 'tabelas-go'], other)).code).toBe(1)
    expect(readPlan().errors[0]?.message).toMatch(/tabela 40 ausente/)
  })
})

describe('ingest discover: fonte fixada em http (ADR 0028)', () => {
  const url = 'http://sped.rfb.gov.br/arquivo/download/7233'
  const finalUrl = 'http://sped.rfb.gov.br/estatico/guia.pdf'

  it('grava um plano que o load aceita, com a URL http pedida e a final', async () => {
    const fetcher = fakeFetcher({
      ...DEFAULT_RESPONSES,
      [url]: { status: 200, url: finalUrl, headers: {}, body: GUIA_PDF },
    })
    const { code } = await discover([], fetcher, testCorpusConfig({ guiaUrl: url }))
    expect(code).toBe(0)
    const plan = readPlan()
    expect(plan.errors).toEqual([])
    expect(plan.items[0]).toMatchObject({ url, finalUrl, origin: 'source' })
    expect(readMatrix()[0]?.url).toBe(finalUrl)
    const [first, ...rest] = plan.items
    const foreign = { ...plan, items: [{ ...first, url: 'http://www.gov.br/x' }, ...rest] }
    expect(planSchema.safeParse(foreign).success).toBe(false)
  })
})

describe('parseDiscoverArgs', () => {
  it.each([
    [['--out', 'x'], /--target/],
    [['--target', 'fixture', '--out', 'x'], /--target/],
    [['--target', 'staging'], /--out é obrigatório/],
    [['--target', 'staging', '--out', 'x', '--family', 'rcte,nada'], /família desconhecida: nada/],
    [['--target', 'staging', '--out', 'x', '--nada'], /Unknown option/],
  ])('recusa %j', (args, message) => {
    expect(() => parseDiscoverArgs(args)).toThrow(CliUsageError)
    expect(() => parseDiscoverArgs(args)).toThrow(message)
  })

  it('aceita --family repetida e com vírgula, sem duplicar', () => {
    expect(
      parseDiscoverArgs([
        '--target',
        'production',
        '--out',
        'x',
        '--family',
        'rcte',
        '--family',
        'cte,rcte',
      ]),
    ).toEqual({ target: 'production', out: 'x', families: ['rcte', 'cte'] })
  })
})
