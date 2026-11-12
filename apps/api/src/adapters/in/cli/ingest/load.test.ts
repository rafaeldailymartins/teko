import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { sha256ContentHasher } from '#adapters/out/crypto/sha256-content-hasher.ts'
import {
  createInMemoryBlobStore,
  type InMemoryBlobStore,
} from '#adapters/out/fakes/in-memory-blob-store.ts'
import { BlobStoreName } from '#app/ports/blob-store.ts'
import { DatabaseSizeLimitError } from '#app/ports/database-usage.ts'
import { Modality, ReviewStatus, ValidityBasis } from '#domain/corpus/family.ts'
import { indexOverrides, type Override, overrideSchema } from '#domain/corpus/overrides.ts'
import type { ParsedSource } from '#domain/corpus/parsed-source.ts'
import { CliUsageError } from './cli-common.ts'
import { readCorpusLock } from './corpus-lock.ts'
import { runIngestDiscover } from './discover.ts'
import { type IngestLoadDeps, type LoadUseCases, parseLoadArgs, runIngestLoad } from './load.ts'

type IngestDocumentVersionCommand = Parameters<LoadUseCases['ingestDocumentVersion']>[0]

import { type Parser, type ParserInput, ParserName } from './parsers/parser.ts'
import { type Plan, planSchema } from './plan.ts'
import { fakeFetcher, GUIA_PDF, sha256, testCorpusConfig } from './testing/corpus-fixture.ts'

const config = testCorpusConfig()
const REVIEW_NOTE = 'Redação com vigência de 01.01.98 a ??'
const RCTE_KEY = 'go:rcte:art:76:par:6'

let dir: string
let planFile: string
let doclingDir: string
let lockFile: string
let blobs: InMemoryBlobStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'teko-load-'))
  planFile = join(dir, 'ingest', 'plan.json')
  doclingDir = join(dir, 'docling')
  lockFile = join(dir, 'corpus.lock.json')
  blobs = createInMemoryBlobStore()
  const code = await runIngestDiscover(
    { config, fetcher: fakeFetcher(), blobs, print: () => undefined },
    ['--target', 'staging', '--out', join(dir, 'ingest')],
  )
  expect(code).toBe(0)
  writeDoclingParts()
})

function plan(): Plan {
  return planSchema.parse(JSON.parse(readFileSync(planFile, 'utf8')))
}

function writeDoclingParts(skip: readonly string[] = []): void {
  for (const item of plan().items) {
    for (const part of item.docling) {
      if (skip.includes(part.id)) {
        continue
      }
      mkdirSync(join(doclingDir, part.id), { recursive: true })
      writeFileSync(join(doclingDir, part.id, 'docling.json'), JSON.stringify({ part: part.id }))
    }
  }
}

const inputs: ParserInput[] = []

const fakeParser: Parser = (input) => {
  inputs.push(input)
  const { source } = input
  const reviewed = source.family === 'rcte'
  return {
    document: source.document,
    version: {
      versionLabel: source.versionLabel ?? `${source.document.title} consolidado`,
      publishedOn: source.publishedOn ?? source.externalTable?.dtVersao ?? '2026-09-16',
      validDuring: source.versionValidDuring ?? { from: '2026-09-16', to: null },
      consolidatedUntil: null,
      actRef: source.actRef,
      sha256: input.sha256,
    },
    replacementWindow: { from: null, to: null },
    provisions: [
      {
        stableKey: reviewed ? RCTE_KEY : `br:efd-icms-ipi:reg:C170`,
        kind: 'paragrafo',
        sortPath: '1',
        headingPath: 'X',
        versions: [
          {
            displayLabel: 'X',
            validDuring: { from: '2020-01-01', to: null },
            modality: Modality.Mandatory,
            validityBasis: ValidityBasis.LegalEffect,
            retroactive: false,
            reviewStatus: reviewed ? ReviewStatus.Pending : ReviewStatus.Auto,
            review: reviewed ? { reason: 'note-unparsed', rawNote: REVIEW_NOTE } : undefined,
            text: 'texto',
          },
        ],
      },
    ],
    skipped: [],
    stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
  } satisfies ParsedSource
}

const PARSERS: Record<ParserName, Parser> = {
  [ParserName.GoHtmlStateMachine]: fakeParser,
  [ParserName.DoclingGuia]: fakeParser,
  [ParserName.DoclingGeneric]: fakeParser,
  [ParserName.ReinfXsd]: fakeParser,
  [ParserName.SpedTabelas]: fakeParser,
}

/** Revisões distintas por parser, para o teste conferir que o `load` passa a da fonte. */
const PARSER_REVISIONS: Record<ParserName, number> = {
  [ParserName.GoHtmlStateMachine]: 1,
  [ParserName.DoclingGuia]: 2,
  [ParserName.DoclingGeneric]: 3,
  [ParserName.ReinfXsd]: 4,
  [ParserName.SpedTabelas]: 5,
}

interface Recorder {
  readonly ingested: IngestDocumentVersionCommand[]
  readonly finished: { status: string; report: Readonly<Record<string, unknown>> }[]
  readonly exports: number[]
  started: { bulk?: boolean | undefined; target: string } | null
  coverageCalls: number
}

function useCases(
  options: {
    corpusVersion?: number
    ingest?: (
      command: IngestDocumentVersionCommand,
      index: number,
    ) => Awaited<ReturnType<LoadUseCases['ingestDocumentVersion']>>
  } = {},
): { useCases: LoadUseCases; recorder: Recorder } {
  const recorder: Recorder = {
    ingested: [],
    finished: [],
    exports: [],
    started: null,
    coverageCalls: 0,
  }
  const corpusVersion = options.corpusVersion ?? 7
  return {
    recorder,
    useCases: {
      startIngestionRun: (command) => {
        recorder.started = command
        return Promise.resolve({ runId: 'run-1' })
      },
      finishIngestionRun: (command) => {
        recorder.finished.push(command)
        return Promise.resolve()
      },
      ingestDocumentVersion: (command) => {
        recorder.ingested.push(command)
        const result = options.ingest?.(command, recorder.ingested.length - 1) ?? {
          status: 'published' as const,
          documentVersionId: `dv-${String(recorder.ingested.length)}`,
          reprocessed: false,
          provisionVersionsNew: 1,
          provisionVersionsWidened: 0,
          provisionVersionsSplit: 0,
          knowledgeClosed: 0,
          chunksNew: 2,
          reviewItems: command.source.provisions.some((p) =>
            p.versions.some((v) => v.review !== undefined),
          )
            ? 1
            : 0,
          neurons: 10,
        }
        return Promise.resolve(result)
      },
      refreshCoverage: () => {
        recorder.coverageCalls += 1
        return Promise.resolve({ corpusVersion })
      },
      exportSnapshot: async (command) => {
        recorder.exports.push(command.corpusVersion ?? 0)
        const manifestKey = `snapshots/${String(corpusVersion)}/manifest.json`
        await blobs.set(BlobStoreName.CorpusSnapshots, manifestKey, '{"manifest":1}')
        return {
          manifestKey,
          manifest: {
            format: 1,
            corpusVersion,
            createdAt: '2026-11-11T12:00:00.000Z',
            migration: { hash: 'mig-hash', name: null },
            tables: [],
          },
        }
      },
    },
  }
}

function deps(cases: LoadUseCases, extra: Partial<IngestLoadDeps> = {}) {
  const lines: string[] = []
  const migrations: number[] = []
  const value: IngestLoadDeps = {
    config,
    blobs,
    parsers: PARSERS,
    parserRevisions: PARSER_REVISIONS,
    overrides: new Map(),
    hasher: sha256ContentHasher,
    useCases: cases,
    migrate: () => {
      migrations.push(1)
      return Promise.resolve()
    },
    gitSha: 'a'.repeat(40),
    today: () => '2026-11-11',
    defaultLockFile: lockFile,
    print: (line) => lines.push(line),
    ...extra,
  }
  return { value, lines, migrations }
}

function load(value: IngestLoadDeps, extra: string[] = []) {
  return runIngestLoad(value, [
    '--target',
    'staging',
    '--plan',
    planFile,
    '--docling-dir',
    doclingDir,
    ...extra,
  ])
}

beforeEach(() => {
  inputs.length = 0
})

describe('ingest load', () => {
  it('carrega na ordem, grava Blobs, aplica overrides, exporta o snapshot e atualiza o lock', async () => {
    const { useCases: cases, recorder } = useCases()
    const noteHash = sha256ContentHasher.hash(REVIEW_NOTE)
    const override: Override = overrideSchema.parse({
      stable_key: RCTE_KEY,
      note_hash: noteHash,
      action: 'approve',
      reason: 'conferido',
      reviewed_by: 'mantenedor',
      reviewed_at: '2026-11-11',
    })
    const report = join(dir, 'report.json')
    const { value, lines, migrations } = deps(cases, { overrides: indexOverrides([override]) })
    const code = await load(value, ['--migrate', '--bulk', '--report', report])
    expect(code).toBe(0)
    expect(migrations).toEqual([1])
    expect(recorder.started).toEqual({ target: 'staging', gitSha: 'a'.repeat(40), bulk: true })
    // Documentos na ordem do sources.yaml; EFD-GO 5.8 (2025) antes da 5.9 (2026).
    expect(
      recorder.ingested.map(
        (command) => command.source.document.slug + ':' + command.source.version.versionLabel,
      ),
    ).toEqual([
      'guia-pratico-efd-icms-ipi:Guia 3.2.4',
      'guia-pratico-efd-goias:Guia GO 5.8',
      'guia-pratico-efd-goias:Guia GO 5.9',
      'rcte:RCTE consolidado',
      'tabela-go-5-5:Tabela 5.5 consolidado',
      'leiautes-efd-reinf:REINF 2.1.2',
    ])
    // Cada documento leva a revisão do próprio parser (ADR 0026).
    expect(recorder.ingested.map((command) => command.parserRevision)).toEqual([2, 3, 3, 1, 5, 4])
    const guiaSha = sha256(GUIA_PDF)
    const guia = recorder.ingested[0]
    expect(guia?.blobRaw).toBe(`efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${guiaSha}.pdf`)
    expect(guia?.blobDocling).toBe(
      `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${guiaSha}-p1-2.json`,
    )
    expect(inputs[0]?.docling).toEqual([{ part: `${guiaSha}-p1-2` }, { part: `${guiaSha}-p3-4` }])
    expect(blobs.keys(BlobStoreName.CorpusDocling)).toHaveLength(4)
    expect(blobs.keys(BlobStoreName.CorpusRaw)).toHaveLength(6)
    // Tabela: versão do WS na chave e metadados repassados ao parser.
    expect(recorder.ingested[4]?.blobRaw).toMatch(/^tabelas-go\/tabela-go-5-5\/v5\//)
    expect(inputs[4]?.source.externalTable?.versao).toBe(5)
    // Consolidado: slug do rótulo parseado.
    expect(recorder.ingested[3]?.blobRaw).toMatch(/^rcte\/rcte\/rcte-consolidado\//)
    // Zip: membros entregues ao parser.
    expect([...(inputs[5]?.members.keys() ?? [])]).toEqual([
      '20240930/R-2010-evtTomadorServicos-v2_01_02d.xsd',
    ])
    // Override aprovado: sem review e approved.
    const rcteVersion = recorder.ingested[3]?.source.provisions[0]?.versions[0]
    expect(rcteVersion?.reviewStatus).toBe('approved')
    expect(rcteVersion?.review).toBeUndefined()

    expect(recorder.exports).toEqual([7])
    expect(recorder.finished).toHaveLength(1)
    expect(recorder.finished[0]?.status).toBe('succeeded')
    expect(recorder.finished[0]?.report).toMatchObject({
      chunksNew: 12,
      neurons: 60,
      reviewItems: 0,
      corpusVersion: 7,
      lockChanged: true,
    })
    const lock = readCorpusLock(lockFile)
    expect(lock.corpusVersion).toBe(7)
    expect(lock.snapshot).toMatchObject({
      manifestKey: 'snapshots/7/manifest.json',
      migration: 'mig-hash',
      manifestSha256: sha256(new TextEncoder().encode('{"manifest":1}')),
    })
    expect(Object.keys(lock.sources)).toHaveLength(6)
    expect(lock.sources['efd-icms-ipi/guia-pratico/3.2.4']).toEqual({
      sha256: guiaSha,
      versionLabel: 'Guia 3.2.4',
      publishedOn: '2026-07-30',
    })
    expect(JSON.parse(readFileSync(report, 'utf8'))).toMatchObject({
      runId: 'run-1',
      status: 'succeeded',
    })
    expect(JSON.parse(lines.at(-1) ?? '{}')).toEqual({
      runId: 'run-1',
      status: 'succeeded',
      chunksNew: 12,
      neurons: 60,
      corpusVersion: 7,
    })
  })

  it('não exporta nem reescreve o lock quando nada mudou', async () => {
    const first = useCases()
    await load(deps(first.useCases).value)
    const before = readFileSync(lockFile, 'utf8')
    const second = useCases({
      ingest: () => ({ status: 'unchanged', documentVersionId: 'dv' }),
    })
    expect(await load(deps(second.useCases).value)).toBe(0)
    expect(second.recorder.exports).toEqual([])
    expect(readFileSync(lockFile, 'utf8')).toBe(before)
    expect(second.recorder.finished[0]?.report).toMatchObject({ chunksNew: 0, lockChanged: false })
    // Na segunda execução o docling vem da pasta de novo; sem ela, viria do Blobs.
  })

  it('para no orçamento esgotado, fecha como budget_exhausted e sai com 75', async () => {
    const { useCases: cases, recorder } = useCases({
      ingest: (_command, index) =>
        index === 1
          ? { status: 'budget_exhausted', neurons: 5, embeddedChunks: 3, pendingChunks: 40 }
          : {
              status: 'published',
              documentVersionId: 'dv',
              reprocessed: false,
              provisionVersionsNew: 1,
              provisionVersionsWidened: 0,
              provisionVersionsSplit: 0,
              knowledgeClosed: 0,
              chunksNew: 2,
              reviewItems: 0,
              neurons: 10,
            },
    })
    expect(await load(deps(cases).value)).toBe(75)
    expect(recorder.ingested).toHaveLength(2)
    expect(recorder.coverageCalls).toBe(1)
    expect(recorder.exports).toEqual([])
    expect(recorder.finished[0]).toMatchObject({
      status: 'budget_exhausted',
      report: { neurons: 15, pendingChunks: 40, budgetExhaustedAt: 'efd-go/guia-pratico/5.8' },
    })
    expect(readCorpusLock(lockFile).snapshot).toBeNull()
  })

  it('uma fonte com erro não impede as outras: run failed, sem snapshot, código 1', async () => {
    const guiaSha = sha256(GUIA_PDF)
    writeFileSync(join(dir, 'ingest', 'files', `${guiaSha}.pdf`), 'adulterado')
    const failing: Parser = (input) => {
      if (input.source.family === 'efd-reinf') {
        throw new Error('XSD inválido')
      }
      return fakeParser(input)
    }
    const { useCases: cases, recorder } = useCases()
    const { value } = deps(cases, { parsers: { ...PARSERS, [ParserName.ReinfXsd]: failing } })
    expect(await load(value)).toBe(1)
    expect(recorder.ingested).toHaveLength(4)
    expect(recorder.exports).toEqual([])
    const items = recorder.finished[0]?.report['items'] as { sourceId: string; error?: string }[]
    expect(
      items.filter((item) => item.error !== undefined).map((item) => [item.sourceId, item.error]),
    ).toEqual([
      ['efd-icms-ipi/guia-pratico/3.2.4', expect.stringMatching(/não confere com o sha256/)],
      ['efd-reinf/leiautes/2.1.2', 'Error: XSD inválido'],
    ])
    expect(recorder.finished[0]?.status).toBe('failed')
  })

  it('lê do Blobs a parte do Docling que não veio do extract e falha se não houver', async () => {
    const guiaSha = sha256(GUIA_PDF)
    const blobKey = `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${guiaSha}-p3-4.json`
    const fresh = join(dir, 'docling-2')
    for (const item of plan().items) {
      for (const part of item.docling.filter((entry) => entry.id !== `${guiaSha}-p3-4`)) {
        mkdirSync(join(fresh, part.id), { recursive: true })
        writeFileSync(join(fresh, part.id, 'docling.json'), JSON.stringify({ part: part.id }))
      }
    }
    await blobs.set(BlobStoreName.CorpusDocling, blobKey, JSON.stringify({ part: 'do-blobs' }))
    const ok = useCases()
    expect(
      await runIngestLoad(deps(ok.useCases).value, [
        '--target',
        'staging',
        '--plan',
        planFile,
        '--docling-dir',
        fresh,
      ]),
    ).toBe(0)
    expect(inputs[0]?.docling).toEqual([{ part: `${guiaSha}-p1-2` }, { part: 'do-blobs' }])

    await blobs.delete(BlobStoreName.CorpusDocling, blobKey)
    const missing = useCases()
    expect(
      await runIngestLoad(deps(missing.useCases).value, [
        '--target',
        'staging',
        '--plan',
        planFile,
        '--docling-dir',
        fresh,
      ]),
    ).toBe(1)
    const items = missing.recorder.finished[0]?.report['items'] as { error?: string }[]
    expect(items[0]?.error).toMatch(/docling.json da parte .*-p3-4 ausente/)
  })

  it('a guarda de tamanho do banco derruba o run com mensagem clara', async () => {
    const { useCases: cases, recorder } = useCases({
      ingest: () => {
        throw new DatabaseSizeLimitError(900, 800)
      },
    })
    await expect(load(deps(cases).value)).rejects.toBeInstanceOf(DatabaseSizeLimitError)
    expect(recorder.finished[0]?.status).toBe('failed')
    expect(String(recorder.finished[0]?.report['error'])).toMatch(/^guarda de tamanho do banco/)
  })

  it('erro inesperado fecha o run como failed e propaga', async () => {
    const { useCases: cases, recorder } = useCases()
    const broken: LoadUseCases = {
      ...cases,
      refreshCoverage: () => Promise.reject(new Error('conexão caiu')),
    }
    await expect(load(deps(broken).value)).rejects.toThrow('conexão caiu')
    expect(recorder.finished[0]).toMatchObject({
      status: 'failed',
      report: { error: 'Error: conexão caiu' },
    })
  })

  it('recusa plano de outro alvo e fonte que saiu do sources.yaml', async () => {
    const { useCases: cases } = useCases()
    await expect(
      runIngestLoad(deps(cases).value, [
        '--target',
        'production',
        '--plan',
        planFile,
        '--docling-dir',
        doclingDir,
      ]),
    ).rejects.toThrow(/plano de staging/)
    writeFileSync(planFile, '{"format":1}')
    await expect(load(deps(cases).value)).rejects.toThrow(/plan.json inválido/)
  })

  it('marca como erro a fonte do plano que não está mais habilitada', async () => {
    const reduced = testCorpusConfig()
    const { useCases: cases, recorder } = useCases()
    const { value } = deps(cases, {
      config: {
        ...reduced,
        resolved: reduced.resolved.filter((source) => source.id !== 'rcte/consolidado'),
      },
    })
    expect(await load(value)).toBe(1)
    const items = recorder.finished[0]?.report['items'] as { sourceId: string; error?: string }[]
    expect(items.find((item) => item.sourceId === 'rcte/consolidado')?.error).toMatch(
      /ausente ou desabilitada/,
    )
  })
})

describe('parseLoadArgs', () => {
  const base = ['--plan', 'p.json', '--docling-dir', 'd']

  it.each([
    [['--target', 'production', ...base, '--migrate'], /só valem com --target staging/],
    [['--target', 'production', ...base, '--bulk'], /só valem com --target staging/],
    [['--target', 'staging', '--plan', 'p.json'], /são obrigatórios/],
    [['--target', 'x', ...base], /--target/],
    [['--target', 'staging', ...base, '--nada'], /Unknown option/],
  ])('recusa %j', (args, message) => {
    expect(() => parseLoadArgs(args)).toThrow(CliUsageError)
    expect(() => parseLoadArgs(args)).toThrow(message)
  })

  it('lê os padrões', () => {
    expect(parseLoadArgs(['--target', 'production', ...base, '--lock', 'l.json'])).toEqual({
      target: 'production',
      plan: 'p.json',
      doclingDir: 'd',
      bulk: false,
      migrate: false,
      report: null,
      lock: 'l.json',
    })
  })
})
