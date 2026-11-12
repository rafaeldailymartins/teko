import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runIngestDiscover } from '#adapters/in/cli/ingest/discover.ts'
import { runIngestLoad } from '#adapters/in/cli/ingest/load.ts'
import { PARSERS } from '#adapters/in/cli/ingest/parsers/index.ts'
import { buildCorpusConfig, type CorpusConfig } from '#adapters/in/cli/ingest/sources.ts'
import { buildZip } from '#adapters/in/cli/ingest/testing/zip-builder.ts'
import { sha256ContentHasher } from '#adapters/out/crypto/sha256-content-hasher.ts'
import {
  createInMemoryBlobStore,
  type InMemoryBlobStore,
} from '#adapters/out/fakes/in-memory-blob-store.ts'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import type { SafeFetcher } from '#app/ports/safe-fetcher.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'
import { createIngestionTestContext, type IngestionTestContext } from '../../setup/ingestion.ts'

/**
 * `cli ingest discover` + `cli ingest load` de ponta a ponta, com o registro real de parsers (Tabela
 * 5.5 de Goiás, fixture da frente B, pelo WS de Tabelas Externas), o Postgres do Testcontainers, o fake de embeddings e o Blobs em memória. A rede é um `SafeFetcher` falso.
 * Prova pelo CLI: publicação, snapshot e lock; segunda execução sem linhas nem neurons; código 75
 * quando o orçamento acaba e retomada no run seguinte.
 */

const FIXTURES = fileURLToPath(
  new URL('../../../src/adapters/in/cli/ingest/parsers/__fixtures__/', import.meta.url),
)
const TABLE_TXT = new Uint8Array(readFileSync(join(FIXTURES, 'tabelas', 'tabela-40-v5.txt')))
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** Pacote de XSD da REINF 2.1.2 com os três esquemas reais da fixture da frente B. */
const REINF_ZIP = buildZip(
  [
    'R-2010-evtTomadorServicos-v2_01_02d.xsd',
    'R-4020-evt4020PagtoBeneficiarioPJ-v2_01_02d.xsd',
    'R-4080-evt4080RetencaoRecebimento-v2_01_02d.xsd',
  ].map((name) => ({
    name: `20240930/${name}`,
    data: new Uint8Array(readFileSync(join(FIXTURES, 'reinf', name))),
  })),
)

const URLS = {
  ws: 'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/WsConsulta.asmx/consultarVersoesTabelasExternas?codigoSistema=SpedFiscal',
  table:
    'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40&versao=5',
  reinf:
    'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-reinf/documento-tecnicos/versao-atual/esquemas-xsd/xsd-eventos/@@download/file',
}

const WS_XML = `<?xml version="1.0"?><R><codigoRetorno>101</codigoRetorno><metadadosXml>&lt;tabelas&gt;&lt;tabela id="40" tipo="TP_UTIL_CRED_FISCAIS" desc="5.5-  Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS" versao="5" dtCriacao="2008-12-23" dtVersao="2024-11-04" hash="C73DE89E26DBF1A081B86D0B76819AF0131392C9" /&gt;&lt;/tabelas&gt;</metadadosXml></R>`

const fetcher: SafeFetcher = {
  fetch: (request) => {
    const bodies: Record<string, Uint8Array> = {
      [URLS.ws]: new TextEncoder().encode(WS_XML),
      [URLS.table]: TABLE_TXT,
      [URLS.reinf]: REINF_ZIP,
    }
    const body = bodies[request.url]
    return Promise.resolve(
      body === undefined
        ? { status: 404, url: request.url, headers: {}, body: new Uint8Array() }
        : { status: 200, url: request.url, headers: {}, body },
    )
  },
}

function config(): CorpusConfig {
  return buildCorpusConfig(
    {
      version: 1,
      documents: [
        {
          slug: 'tabela-go-5-5',
          family: 'tabelas-go',
          title:
            'Tabela 5.5 da EFD ICMS/IPI - Goiás (Tabela de Tipos de Utilização dos Créditos Fiscais - ICMS)',
          issuer:
            'Secretaria de Estado da Economia de Goiás (publicada no WS de Tabelas Externas do SPED)',
          source_url:
            'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40',
          parser: 'sped-tabelas',
          validity: 'table',
          sources: [
            {
              id: 'tabelas-go/5-5',
              url: 'https://www.sped.fazenda.gov.br/spedtabelas/WsConsulta/obterTabela.ashx?idTabela=40',
              mode: 'ws-tabela',
              ws_table_id: 40,
              format: 'txt',
            },
          ],
        },
      ],
    },
    { version: 1, series: {} },
  )
}

/** Leiautes da REINF 2.1.2 (parser `reinf-xsd`), com o período do `leiaute-periods.yaml`. */
function reinfConfig(): CorpusConfig {
  return buildCorpusConfig(
    {
      version: 1,
      documents: [
        {
          slug: 'leiautes-efd-reinf',
          family: 'efd-reinf',
          title: 'Leiautes dos eventos da EFD-Reinf',
          issuer: 'Receita Federal do Brasil - Coordenação-Geral de Fiscalização (Cofis)',
          source_url:
            'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-reinf/documento-tecnicos/versao-atual/leiautes',
          parser: 'reinf-xsd',
          validity: 'leiaute',
          sources: [
            {
              id: 'efd-reinf/leiautes/2.1.2',
              version: '2.1.2d',
              version_label: 'Leiautes da EFD-Reinf versão 2.1.2 (ADE Cofis nº 23/2023)',
              url: URLS.reinf,
              mode: 'pinned',
              sha256: sha256(REINF_ZIP),
              format: 'zip',
              published_on: '2023-03-16',
              act_ref: 'Ato Declaratório Executivo Cofis nº 23, de 10 de março de 2023',
              leiaute: '2.1.2',
            },
          ],
        },
      ],
    },
    {
      version: 1,
      series: {
        'efd-reinf': {
          title: 'Leiautes da EFD-Reinf',
          source_url:
            'https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-reinf/documento-tecnicos/versao-atual/leiautes',
          periods: [
            {
              code: '2.1.2',
              from: '2023-09-01',
              to: null,
              act: 'Ato Declaratório Executivo Cofis nº 23, de 10 de março de 2023',
            },
          ],
        },
      },
    },
  )
}

let database: TestDatabase
let owner: pg.Client
let blobs: InMemoryBlobStore
let dir: string
const contexts: IngestionTestContext[] = []

beforeEach(async () => {
  database = await createTestDatabase()
  owner = new pg.Client({ connectionString: database.ownerUrl })
  await owner.connect()
  blobs = createInMemoryBlobStore()
  dir = mkdtempSync(join(tmpdir(), 'teko-ingest-cli-'))
}, 120_000)

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    await context.container.close()
  }
  await owner?.end()
  await database?.drop()
})

async function count(table: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM corpus.${table}`,
  )
  return rows[0]?.n ?? 0
}

async function discover(cfg: CorpusConfig): Promise<string> {
  const out = join(dir, 'ingest')
  const code = await runIngestDiscover({ config: cfg, fetcher, blobs, print: () => undefined }, [
    '--target',
    'staging',
    '--out',
    out,
  ])
  expect(code).toBe(0)
  return join(out, 'plan.json')
}

async function load(
  cfg: CorpusConfig,
  plan: string,
  options: Parameters<typeof createIngestionTestContext>[1] = {},
) {
  const context = createIngestionTestContext(database.ownerUrl, { blobs, ...options })
  contexts.push(context)
  const lines: string[] = []
  const lock = join(dir, 'corpus.lock.json')
  const report = join(dir, 'report.json')
  const code = await runIngestLoad(
    {
      config: cfg,
      blobs,
      parsers: PARSERS,
      overrides: new Map(),
      hasher: sha256ContentHasher,
      useCases: context.container.useCases,
      migrate: () => Promise.resolve(),
      gitSha: 'c'.repeat(40),
      today: () => '2026-11-11',
      defaultLockFile: lock,
      print: (line) => lines.push(line),
    },
    [
      '--target',
      'staging',
      '--plan',
      plan,
      '--docling-dir',
      join(dir, 'docling'),
      '--report',
      report,
    ],
  )
  return { code, context, lock, report, lines }
}

describe('cli ingest discover + load (Postgres real)', () => {
  it('publica, exporta o snapshot e grava o lock; a segunda execução não gera linhas nem neurons', async () => {
    const cfg = config()
    const plan = await discover(cfg)
    const first = await load(cfg, plan)
    expect(first.code, readFileSync(first.report, 'utf8')).toBe(0)
    expect(await count('document_versions')).toBe(1)
    const provisionVersions = await count('provision_versions')
    expect(provisionVersions).toBeGreaterThan(10)
    expect(first.context.spy.texts()).toBeGreaterThan(0)
    const lock = JSON.parse(readFileSync(first.lock, 'utf8')) as {
      corpusVersion: number
      snapshot: { manifestKey: string }
      sources: Record<string, unknown>
    }
    expect(Object.keys(lock.sources)).toEqual(['tabelas-go/5-5'])
    expect(await blobs.get(BlobStoreName.CorpusSnapshots, lock.snapshot.manifestKey)).not.toBeNull()
    expect(blobs.keys(BlobStoreName.CorpusRaw)).toEqual([
      `tabelas-go/tabela-go-5-5/v5/${sha256(TABLE_TXT)}.txt`,
    ])
    const report = JSON.parse(readFileSync(first.report, 'utf8')) as {
      status: string
      chunksNew: number
    }
    expect(report.status).toBe('succeeded')
    expect(report.chunksNew).toBeGreaterThan(0)

    const lockBefore = readFileSync(first.lock, 'utf8')
    const second = await load(cfg, await discover(cfg))
    expect(second.code).toBe(0)
    expect(second.context.spy.calls).toEqual([])
    expect(await count('provision_versions')).toBe(provisionVersions)
    expect(readFileSync(second.lock, 'utf8')).toBe(lockBefore)
    const { rows } = await owner.query<{ neurons: number; status: string }>(
      'SELECT neurons, status FROM corpus.ingestion_runs WHERE id = $1',
      [(JSON.parse(readFileSync(second.report, 'utf8')) as { runId: string }).runId],
    )
    expect(rows[0]).toEqual({ neurons: 0, status: 'succeeded' })
  })

  it('sai com 75 quando o orçamento acaba e o run seguinte retoma até publicar', async () => {
    const cfg = config()
    const plan = await discover(cfg)
    const exhausted = await load(cfg, plan, {
      budget: 1,
      neuronsPerCall: 1,
      batchLimits: { maxItems: 2, maxPaddedTokens: 48_000 },
    })
    expect(exhausted.code).toBe(75)
    expect(JSON.parse(readFileSync(exhausted.report, 'utf8'))).toMatchObject({
      status: 'budget_exhausted',
    })
    expect(JSON.parse(exhausted.lines.at(-1) ?? '{}')).toMatchObject({ status: 'budget_exhausted' })

    const resumed = await load(cfg, plan, { budget: 10_000 })
    expect(resumed.code).toBe(0)
    expect(await count('document_versions')).toBe(1)
  })

  it('publica os leiautes reais da REINF, com grupos achatados (pai e filho no mesmo nível da chave)', async () => {
    const cfg = reinfConfig()
    const run = await load(cfg, await discover(cfg))
    expect(run.code, readFileSync(run.report, 'utf8')).toBe(0)
    expect(await count('document_versions')).toBe(1)
    expect(await count('provision_versions')).toBeGreaterThan(50)
    const { rows } = await owner.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM corpus.provisions p
       JOIN corpus.provisions pp ON pp.id = p.parent_id
       WHERE array_length(string_to_array(p.stable_key, ':'), 1)
           = array_length(string_to_array(pp.stable_key, ':'), 1)`,
    )
    expect(rows[0]?.n).toBeGreaterThan(0)
    const second = await load(cfg, await discover(cfg))
    expect(second.code).toBe(0)
    expect(second.context.spy.calls).toEqual([])
  })
})
