import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CliUsageError } from '../ingest/cli-common.ts'
import { fixtureDocumentSchema } from '../seed-fixtures/fixture-schema.ts'
import {
  type FixtureCorpusReader,
  FixtureExportError,
  type FixtureSelection,
  parseEvalFixtureArgs,
  restrictDocument,
  runEvalFixtureExport,
} from './eval-fixture.ts'

const VERSION = {
  key: 'rcte-2026-09-16',
  versionLabel: 'RCTE consolidado até o Decreto nº 10.986, de 16.09.26',
  publishedOn: '2026-09-16',
  validDuring: { from: '2026-09-16', to: null },
  sha256: 'a'.repeat(64),
}

function provision(stableKey: string, sortPath: string, parent?: string) {
  return {
    stableKey,
    kind: 'paragrafo',
    ...(parent === undefined ? {} : { parent }),
    sortPath,
    headingPath: `RCTE > ${stableKey}`,
    versions: [
      {
        displayLabel: stableKey,
        validDuring: { from: '1998-01-01', to: null },
        validityBasis: 'legal_effect',
        text: `texto ${stableKey}`,
        documentVersions: [VERSION.key],
      },
    ],
  }
}

function document(provisions: unknown[]) {
  return {
    slug: 'rcte',
    family: 'rcte',
    title: 'RCTE',
    issuer: 'Goiás',
    sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
    versions: [VERSION],
    provisions,
  }
}

const COVERAGE = [
  { family: 'rcte', covered: [{ from: '1998-01-01', to: null }], verifiedAt: '2026-11-11' },
  { family: 'cte', covered: [{ from: '1997-01-01', to: null }], verifiedAt: '2026-11-11' },
]

function currentFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'teko-fixture-'))
  mkdirSync(join(dir, 'documents'))
  writeFileSync(
    join(dir, 'documents', 'rcte.json'),
    JSON.stringify(
      document([
        provision('go:rcte:art:76', '0076'),
        provision('go:rcte:art:76:par:6', '0076.p06', 'go:rcte:art:76'),
      ]),
    ),
  )
  return dir
}

function reader(documents: unknown[], coverage: unknown = COVERAGE) {
  const calls: FixtureSelection[][] = []
  const value: FixtureCorpusReader = {
    readDocuments: (selection) => {
      calls.push([...selection])
      return Promise.resolve(documents)
    },
    readCoverage: () => Promise.resolve(coverage),
  }
  return { value, calls }
}

describe('eval-fixture export', () => {
  it('regenera só os dispositivos da fixture atual, com a cobertura das famílias dela', async () => {
    const fixture = currentFixture()
    const out = mkdtempSync(join(tmpdir(), 'teko-export-'))
    const staging = document([
      provision('go:rcte:art:76:par:6', '0076.p06', 'go:rcte:art:76'),
      provision('go:rcte:art:77', '0077'),
      provision('go:rcte:art:76', '0076'),
    ])
    const { value, calls } = reader([staging, { ...staging, slug: 'outro-documento' }])
    const lines: string[] = []
    const code = await runEvalFixtureExport({ reader: value, print: (line) => lines.push(line) }, [
      'export',
      '--from',
      'staging',
      '--out',
      out,
      '--fixture',
      fixture,
    ])
    expect(code).toBe(0)
    expect(calls[0]).toEqual([
      { slug: 'rcte', stableKeys: ['go:rcte:art:76', 'go:rcte:art:76:par:6'] },
    ])
    expect(readdirSync(join(out, 'documents'))).toEqual(['rcte.json'])
    const written = JSON.parse(readFileSync(join(out, 'documents', 'rcte.json'), 'utf8')) as {
      provisions: { stableKey: string }[]
    }
    expect(written.provisions.map((entry) => entry.stableKey)).toEqual([
      'go:rcte:art:76',
      'go:rcte:art:76:par:6',
    ])
    const coverage = JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8')) as {
      family: string
    }[]
    expect(coverage.map((entry) => entry.family)).toEqual(['rcte'])
    expect(JSON.parse(lines[0] ?? '{}')).toEqual({
      out,
      documents: [{ slug: 'rcte', provisions: 2, missing: 0 }],
    })
  })

  it('falha com documento fora do formato, ausente ou sem nenhum dispositivo', async () => {
    const fixture = currentFixture()
    const out = mkdtempSync(join(tmpdir(), 'teko-export-'))
    const args = ['export', '--from', 'staging', '--out', out, '--fixture', fixture]
    const print = () => undefined
    await expect(
      runEvalFixtureExport({ reader: reader([{ slug: 'rcte' }]).value, print }, args),
    ).rejects.toThrow(/fora do formato/)
    await expect(runEvalFixtureExport({ reader: reader([]).value, print }, args)).rejects.toThrow(
      /ausentes do staging: rcte/,
    )
    await expect(
      runEvalFixtureExport(
        { reader: reader([document([provision('go:rcte:art:1', '0001')])]).value, print },
        args,
      ),
    ).rejects.toThrow(FixtureExportError)
    const staging = document([provision('go:rcte:art:76', '0076')])
    await expect(
      runEvalFixtureExport({ reader: reader([staging], [{ family: 'x' }]).value, print }, args),
    ).rejects.toThrow(/cobertura do staging fora do formato/)
  })
})

describe('restrictDocument', () => {
  it('remove o pai que ficou de fora da seleção', () => {
    const parsed = fixtureDocumentSchema.parse(
      document([
        provision('go:rcte:art:76', '0076'),
        provision('go:rcte:art:76:par:6', '0076.p06', 'go:rcte:art:76'),
      ]),
    )
    const restricted = restrictDocument(parsed, new Set(['go:rcte:art:76:par:6']))
    expect(restricted.provisions[0]).not.toHaveProperty('parent')
  })
})

describe('parseEvalFixtureArgs', () => {
  it.each([
    [[], /subcomando desconhecido: \(nenhum\)/],
    [['importar'], /subcomando desconhecido: importar/],
    [['export', '--out', 'x'], /--from só aceita staging/],
    [['export', '--from', 'production', '--out', 'x'], /--from só aceita staging/],
    [['export', '--from', 'staging'], /--out é obrigatório/],
    [['export', '--from', 'staging', '--out', 'x', '--y'], /Unknown option/],
  ])('recusa %j', (args, message) => {
    expect(() => parseEvalFixtureArgs(args)).toThrow(CliUsageError)
    expect(() => parseEvalFixtureArgs(args)).toThrow(message)
  })

  it('usa a fixture padrão', () => {
    expect(parseEvalFixtureArgs(['export', '--from', 'staging', '--out', 'x'])).toEqual({
      from: 'staging',
      out: 'x',
      fixture: 'test/fixtures/corpus',
    })
  })
})
