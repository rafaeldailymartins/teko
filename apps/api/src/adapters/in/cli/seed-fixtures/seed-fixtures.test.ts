import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { WriteCorpus } from '#app/use-cases/write-corpus.ts'
import { fixtureCoverageSchema, fixtureDocumentSchema } from './fixture-schema.ts'
import {
  DEFAULT_FIXTURE_DIR,
  FixtureFileError,
  loadFixtureCommand,
  loadFixtureDocuments,
  seedFixtures,
} from './seed-fixtures.ts'

const SHA = 'a'.repeat(64)

function document(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'rcte',
    family: 'rcte',
    title: 'RCTE',
    issuer: 'Goiás',
    sourceUrl: 'https://appasp.economia.go.gov.br/Legislacao/arquivos/Rcte/RCTE.htm',
    versions: [
      {
        key: 'v2026',
        versionLabel: 'RCTE consolidado',
        publishedOn: '2026-09-16',
        validDuring: { from: '2026-09-16', to: null },
        sha256: SHA,
      },
    ],
    provisions: [
      {
        stableKey: 'go:rcte:art:76',
        kind: 'artigo',
        sortPath: '0076',
        headingPath: 'RCTE > Art. 76',
        versions: [
          {
            displayLabel: 'RCTE, art. 76',
            validDuring: { from: '1998-01-01', to: null },
            validityBasis: 'legal_effect',
            text: 'Art. 76. ...',
            documentVersions: ['v2026'],
          },
        ],
      },
    ],
    ...overrides,
  }
}

function issuesOf(value: unknown): string[] {
  const result = fixtureDocumentSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('fixtureDocumentSchema', () => {
  it('aplica os padrões de redação e de versão de documento', () => {
    const parsed = fixtureDocumentSchema.parse(document())
    expect(parsed.versions[0]).toMatchObject({ consolidatedUntil: null, actRef: null })
    expect(parsed.provisions[0]?.versions[0]).toMatchObject({
      modality: 'mandatory',
      retroactive: false,
      reviewStatus: 'auto',
    })
  })

  it('aponta stable_key repetida, fora da família, versão de documento e pai desconhecidos', () => {
    const [provision] = document().provisions
    const child = {
      ...provision,
      stableKey: 'go:rcte:art:76:par:1',
      parent: 'go:rcte:art:75',
      versions: [{ ...provision?.versions[0], documentVersions: ['v1999'] }],
    }
    expect(
      issuesOf(
        document({
          provisions: [provision, provision, child, { ...provision, stableKey: 'go:cte:art:1' }],
        }),
      ),
    ).toEqual([
      'stable_key repetida',
      'versão de documento desconhecida: v1999',
      'stable_key fora da família rcte',
      'pai ausente do documento: go:rcte:art:75',
    ])
  })

  it('exige limite inferior na vigência e chave válida', () => {
    const [provision] = document().provisions
    expect(
      issuesOf(
        document({
          provisions: [
            {
              ...provision,
              stableKey: 'go:rcte:artigo:1',
              versions: [
                { ...provision?.versions[0], validDuring: { from: null, to: '2000-01-01' } },
              ],
            },
          ],
        }),
      ),
    ).toEqual(['stable_key inválida', 'valid_during precisa de limite inferior'])
  })

  it('a cobertura tem gaps opcionais', () => {
    expect(
      fixtureCoverageSchema.parse([
        { family: 'rcte', covered: [{ from: '1998-01-01', to: null }], verifiedAt: '2026-11-10' },
      ]),
    ).toEqual([
      {
        family: 'rcte',
        covered: [{ from: '1998-01-01', to: null }],
        verifiedAt: '2026-11-10',
        gaps: [],
      },
    ])
  })
})

describe('seed-fixtures', () => {
  it('a fixture versionada é válida e cobre as famílias do corpus', () => {
    const documents = loadFixtureDocuments(DEFAULT_FIXTURE_DIR)
    expect(documents.length).toBeGreaterThan(0)
    expect(new Set(documents.map((doc) => doc.family))).toEqual(
      new Set(['rcte', 'cte', 'efd-icms-ipi', 'efd-reinf', 'efd-go', 'tabelas-go']),
    )
    const command = loadFixtureCommand(DEFAULT_FIXTURE_DIR, { replace: true })
    expect(command.replace).toBe(true)
    expect(command.notes).toBe(`fixture ${DEFAULT_FIXTURE_DIR}`)
    expect(command.coverage.every((entry) => entry.verifiedAt === '2026-11-10')).toBe(true)
    expect(command.coverage.map((entry) => entry.family)).not.toContain('rcte-anexos')
  })

  it('o § 6º do art. 76 do RCTE tem as três redações do plano no único snapshot de 2026', () => {
    const rcte = loadFixtureDocuments(DEFAULT_FIXTURE_DIR).find((doc) => doc.slug === 'rcte')
    expect(rcte?.versions).toHaveLength(1)
    const paragraph = rcte?.provisions.find((p) => p.stableKey === 'go:rcte:art:76:par:6')
    expect(paragraph?.versions.map((version) => version.validDuring)).toEqual([
      { from: '2003-09-12', to: '2004-11-04' },
      { from: '2004-11-04', to: '2009-11-23' },
      { from: '2009-11-23', to: null },
    ])
  })

  it('arquivo de documento ou de cobertura inválido vira FixtureFileError com o caminho', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teko-seed-'))
    mkdirSync(join(dir, 'documents'))
    writeFileSync(join(dir, 'documents', 'ok.json'), JSON.stringify(document()))
    writeFileSync(join(dir, 'documents', 'notas.txt'), 'ignorado')
    writeFileSync(join(dir, 'coverage.json'), JSON.stringify([{ family: 'rcte' }]))
    expect(loadFixtureDocuments(dir)).toHaveLength(1)
    expect(() => loadFixtureCommand(dir, { replace: false })).toThrow(FixtureFileError)
    expect(() => loadFixtureCommand(dir, { replace: false })).toThrow(/coverage\.json/)

    writeFileSync(join(dir, 'documents', 'ruim.json'), JSON.stringify({ slug: 'x' }))
    expect(() => loadFixtureDocuments(dir)).toThrow(/ruim\.json/)
    const error = new FixtureFileError('a.json', new Error('x'))
    expect(error.name).toBe('FixtureFileError')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('seedFixtures grava a fixture pelo WriteCorpus', async () => {
    const writeCorpus = vi.fn<WriteCorpus>(() =>
      Promise.resolve({ corpusVersion: 1, documents: 9, provisionVersions: 10, chunks: 11 }),
    )
    await expect(
      seedFixtures(writeCorpus, DEFAULT_FIXTURE_DIR, { replace: false }),
    ).resolves.toMatchObject({
      corpusVersion: 1,
    })
    expect(writeCorpus.mock.calls[0]?.[0]).toMatchObject({ replace: false })
  })
})

// Sobe um processo Node que carrega a raiz de composição inteira: lento sob carga e cobertura.
describe('cli', { timeout: 60_000 }, () => {
  function cli(args: string[], env: Record<string, string> = {}) {
    const { PATH, SystemRoot, TEMP, TMP } = process.env
    return spawnSync(process.execPath, ['src/cli.ts', ...args], {
      encoding: 'utf8',
      env: { PATH, SystemRoot, TEMP, TMP, ...env },
      timeout: 50_000,
    })
  }

  it('sem subcomando conhecido mostra o uso e sai com 64', () => {
    const result = cli([])
    expect(result.status).toBe(64)
    expect(result.stderr).toContain('uso: cli seed-fixtures')
    expect(cli(['ingest']).status).toBe(64)
  })

  it('seed-fixtures sem DATABASE_URL ou com env inválido sai com 1', () => {
    const missing = cli(['seed-fixtures'])
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('exige DATABASE_URL')
    const invalid = cli(['seed-fixtures'], { DATABASE_URL: 'postgres://h/db' })
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain('EMBEDDINGS_PROVIDER: obrigatória com DATABASE_URL')
  })
})
