import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SeedFixtureCorpus } from '#app/use-cases/seed-fixture-corpus.ts'
import { tempDir } from '../../../../../test/setup/temp-dir.ts'
import { fixtureCoverageSchema, fixtureDocumentSchema } from './fixture-schema.ts'
import {
  DEFAULT_FIXTURE_DIR,
  FixtureFileError,
  fixtureSources,
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

const SEED_OPTIONS = { replace: false, gitSha: 'abc1234', today: '2026-11-12' } as const

describe('fixtureSources', () => {
  const twoVersions = fixtureDocumentSchema.parse(
    document({
      slug: 'guia-pratico-efd-icms-ipi',
      family: 'efd-icms-ipi',
      title: 'Guia Prático',
      issuer: 'RFB',
      sourceUrl: 'https://www.gov.br/sped',
      versions: [
        {
          key: 'novo',
          versionLabel: 'Guia 3.2.4',
          publishedOn: '2026-07-30',
          validDuring: { from: '2026-01-01', to: null },
          sha256: 'b'.repeat(64),
        },
        {
          key: 'antigo',
          versionLabel: 'Guia 3.1.9',
          publishedOn: '2025-05-13',
          validDuring: { from: '2025-01-01', to: '2026-01-01' },
          sha256: SHA,
        },
      ],
      provisions: [
        {
          stableKey: 'br:efd-icms-ipi:reg:C100',
          kind: 'registro',
          sortPath: 'C100',
          headingPath: 'Guia > C100',
          versions: [
            {
              displayLabel: 'Registro C100',
              validDuring: { from: '2025-01-01', to: null },
              validityBasis: 'leiaute_period',
              text: 'REGISTRO C100',
              documentVersions: ['antigo', 'novo'],
              structured: { campos: 3 },
            },
          ],
        },
        {
          stableKey: 'br:efd-icms-ipi:reg:C100:campo:02',
          kind: 'campo',
          parent: 'br:efd-icms-ipi:reg:C100',
          sortPath: 'C100.02',
          headingPath: 'Guia > C100 > 02',
          versions: [
            {
              displayLabel: 'C100, campo 02',
              validDuring: { from: '2026-01-01', to: null },
              validityBasis: 'leiaute_period',
              text: 'IND_EMIT',
              documentVersions: ['novo'],
              knowledge: { from: '2026-07-30', to: null },
            },
          ],
        },
      ],
    }),
  )

  it('uma fonte por versão de documento, na ordem de publicação, com as redações que a citam', () => {
    const sources = fixtureSources([twoVersions])
    expect(sources.map((source) => source.version.versionLabel)).toEqual([
      'Guia 3.1.9',
      'Guia 3.2.4',
    ])
    const [older, newer] = sources
    expect(older?.version).toEqual({
      versionLabel: 'Guia 3.1.9',
      publishedOn: '2025-05-13',
      validDuring: { from: '2025-01-01', to: '2026-01-01' },
      consolidatedUntil: null,
      actRef: null,
      sha256: SHA,
    })
    expect(older?.provisions.map((provision) => provision.stableKey)).toEqual([
      'br:efd-icms-ipi:reg:C100',
    ])
    expect(newer?.provisions.map((provision) => provision.stableKey)).toEqual([
      'br:efd-icms-ipi:reg:C100',
      'br:efd-icms-ipi:reg:C100:campo:02',
    ])
    // Guias e leiautes reescrevem só o próprio período.
    expect(newer?.replacementWindow).toEqual({ from: '2026-01-01', to: null })
    expect(newer?.provisions[1]).toMatchObject({ parent: 'br:efd-icms-ipi:reg:C100' })
    expect(newer?.provisions[0]).not.toHaveProperty('parent')
    // O knowledge da fixture não vai para a ingestão; structured e amendment só quando existem.
    expect(newer?.provisions[1]?.versions[0]).not.toHaveProperty('knowledge')
    expect(newer?.provisions[1]?.versions[0]).not.toHaveProperty('structured')
    expect(newer?.provisions[0]?.versions[0]).toMatchObject({ structured: { campos: 3 } })
    expect(newer).toMatchObject({
      document: { slug: 'guia-pratico-efd-icms-ipi', family: 'efd-icms-ipi' },
      skipped: [],
      stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
    })
  })

  it('consolidados (RCTE, CTE, tabelas de Goiás) reescrevem todo o histórico', () => {
    const [source] = fixtureSources([fixtureDocumentSchema.parse(document())])
    expect(source?.replacementWindow).toEqual({ from: null, to: null })
  })

  it('a fixture versionada vira as fontes de cada versão, com todas as redações', () => {
    const documents = loadFixtureDocuments(DEFAULT_FIXTURE_DIR)
    const sources = fixtureSources(documents)
    expect(sources).toHaveLength(documents.reduce((sum, doc) => sum + doc.versions.length, 0))
    const cited = new Set(
      documents.flatMap((doc) =>
        doc.provisions.flatMap((provision) =>
          provision.versions.map((version) => `${provision.stableKey}@${version.displayLabel}`),
        ),
      ),
    )
    const ingested = new Set(
      sources.flatMap((source) =>
        source.provisions.flatMap((provision) =>
          provision.versions.map((version) => `${provision.stableKey}@${version.displayLabel}`),
        ),
      ),
    )
    expect(ingested).toEqual(cited)
  })

  it('o knowledge da fixture é sempre atual', () => {
    const [provision] = document().provisions
    expect(
      issuesOf(
        document({
          provisions: [
            {
              ...provision,
              versions: [
                { ...provision?.versions[0], knowledge: { from: '2026-09-16', to: '2026-10-01' } },
              ],
            },
          ],
        }),
      ),
    ).toEqual(['knowledge da fixture é sempre atual (to: null)'])
  })
})

describe('seed-fixtures', () => {
  it('a fixture versionada é válida e cobre as famílias do corpus', () => {
    const documents = loadFixtureDocuments(DEFAULT_FIXTURE_DIR)
    expect(documents.length).toBeGreaterThan(0)
    expect(new Set(documents.map((doc) => doc.family))).toEqual(
      new Set(['rcte', 'cte', 'efd-icms-ipi', 'efd-reinf', 'efd-go', 'tabelas-go']),
    )
    const command = loadFixtureCommand(DEFAULT_FIXTURE_DIR, { ...SEED_OPTIONS, replace: true })
    expect(command).toMatchObject({ replace: true, gitSha: 'abc1234', verifiedAt: '2026-11-10' })
    expect(command.coverage.every((entry) => entry.verifiedAt === '2026-11-10')).toBe(true)
    expect(command.coverage.every((entry) => entry.gapReason === null)).toBe(true)
    expect(command.coverage.map((entry) => entry.family)).not.toContain('rcte-anexos')
  })

  it('cobertura declarada: lacunas com motivo; sem cobertura, o verified_at é hoje', () => {
    const dir = tempDir('teko-seed-')
    mkdirSync(join(dir, 'documents'))
    writeFileSync(join(dir, 'documents', 'rcte.json'), JSON.stringify(document()))
    writeFileSync(
      join(dir, 'coverage.json'),
      JSON.stringify([
        {
          family: 'rcte',
          covered: [{ from: '1998-01-01', to: null }],
          verifiedAt: '2026-11-09',
          gaps: [{ interval: { from: '2026-10-01', to: null }, reason: 'mudança detectada' }],
        },
      ]),
    )
    expect(loadFixtureCommand(dir, SEED_OPTIONS)).toMatchObject({
      verifiedAt: '2026-11-09',
      coverage: [
        {
          family: 'rcte',
          gaps: [{ from: '2026-10-01', to: null }],
          gapReason: 'mudança detectada',
        },
      ],
    })
    writeFileSync(join(dir, 'coverage.json'), '[]')
    expect(loadFixtureCommand(dir, SEED_OPTIONS)).toMatchObject({
      verifiedAt: '2026-11-12',
      coverage: [],
    })
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
    const dir = tempDir('teko-seed-')
    mkdirSync(join(dir, 'documents'))
    writeFileSync(join(dir, 'documents', 'ok.json'), JSON.stringify(document()))
    writeFileSync(join(dir, 'documents', 'notas.txt'), 'ignorado')
    writeFileSync(join(dir, 'coverage.json'), JSON.stringify([{ family: 'rcte' }]))
    expect(loadFixtureDocuments(dir)).toHaveLength(1)
    expect(() => loadFixtureCommand(dir, SEED_OPTIONS)).toThrow(FixtureFileError)
    expect(() => loadFixtureCommand(dir, SEED_OPTIONS)).toThrow(/coverage\.json/)

    writeFileSync(join(dir, 'documents', 'ruim.json'), JSON.stringify({ slug: 'x' }))
    expect(() => loadFixtureDocuments(dir)).toThrow(/ruim\.json/)
    const error = new FixtureFileError('a.json', new Error('x'))
    expect(error.name).toBe('FixtureFileError')
    expect(error.cause).toBeInstanceOf(Error)
  })

  it('seedFixtures grava a fixture pelo SeedFixtureCorpus', async () => {
    const result = {
      runId: 'r1',
      corpusVersion: 1,
      documentVersions: 12,
      unchanged: 0,
      provisionVersions: 1569,
      chunks: 1574,
    }
    const seed = vi.fn<SeedFixtureCorpus>(() => Promise.resolve(result))
    await expect(seedFixtures(seed, DEFAULT_FIXTURE_DIR, SEED_OPTIONS)).resolves.toEqual(result)
    expect(seed.mock.calls[0]?.[0]).toMatchObject({ replace: false, gitSha: 'abc1234' })
    expect(seed.mock.calls[0]?.[0].sources.length).toBeGreaterThan(9)
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
