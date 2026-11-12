import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type FixtureDocument,
  fixtureCoverageSchema,
  fixtureDocumentSchema,
} from '#adapters/in/cli/seed-fixtures/fixture-schema.ts'
import { loadFixtureDocuments } from '#adapters/in/cli/seed-fixtures/seed-fixtures.ts'
import { createDatabase, type Database } from '#adapters/out/persistence/drizzle/client.ts'
import { createPgFixtureCorpusReader } from '#adapters/out/persistence/drizzle/repositories/pg-fixture-corpus-reader.ts'
import { FIXTURE_DIR, seedFixtureCorpus } from '../../setup/corpus.ts'
import { createTestDatabase, type TestDatabase } from '../../setup/database.ts'

/**
 * Round-trip do `FixtureCorpusReader` (Postgres): a fixture única é gravada pelo seed e lida de
 * volta no formato da fixture, como o `cli eval-fixture export` faz contra o staging, conectado
 * como `teko_app` (só leitura). Os documentos batem com os JSON originais, depois de normalizar os
 * campos que o banco não guarda: as chaves locais das versões de documento (trocadas pelo sha256),
 * a ordem dos dispositivos (por `sortPath`), das redações e das versões citadas.
 */

let database: TestDatabase
let connection: Database

function normalize(document: FixtureDocument) {
  const shaOf = new Map(document.versions.map((version) => [version.key, version.sha256]))
  return {
    ...document,
    versions: document.versions
      .map(({ key: _key, ...version }) => version)
      .sort((a, b) => a.sha256.localeCompare(b.sha256)),
    provisions: [...document.provisions]
      .sort(
        (a, b) => a.sortPath.localeCompare(b.sortPath) || a.stableKey.localeCompare(b.stableKey),
      )
      .map((provision) => ({
        ...provision,
        versions: provision.versions
          .map((version) => ({
            ...version,
            documentVersions: version.documentVersions.map((key) => shaOf.get(key) ?? key).sort(),
          }))
          .sort(
            (a, b) =>
              String(a.validDuring.from).localeCompare(String(b.validDuring.from)) ||
              a.text.localeCompare(b.text),
          ),
      })),
  }
}

beforeAll(async () => {
  database = await createTestDatabase()
  await seedFixtureCorpus(database.ownerUrl)
  connection = createDatabase({ url: database.appUrl, applicationName: 'teko-test' })
}, 120_000)

afterAll(async () => {
  await connection?.close()
  await database?.drop()
})

describe('PgFixtureCorpusReader', () => {
  it('devolve os documentos da fixture no formato dela (módulo os campos derivados)', async () => {
    const original = loadFixtureDocuments(FIXTURE_DIR)
    const reader = createPgFixtureCorpusReader(connection.db)
    const read = await reader.readDocuments(
      original.map((document) => ({
        slug: document.slug,
        stableKeys: document.provisions.map((provision) => provision.stableKey),
      })),
    )
    expect(read.map((document) => document.slug)).toEqual(original.map((document) => document.slug))
    for (const [index, raw] of read.entries()) {
      const parsed = fixtureDocumentSchema.parse(raw)
      const expected = original[index] as FixtureDocument
      expect(normalize(parsed), parsed.slug).toEqual(normalize(expected))
      expect(parsed.versions[0]?.key).toMatch(/^v\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/)
    }
  })

  it('limita aos dispositivos pedidos e tira o pai que ficou de fora', async () => {
    const reader = createPgFixtureCorpusReader(connection.db)
    const [rcte] = await reader.readDocuments([
      { slug: 'rcte', stableKeys: ['go:rcte:art:76:par:6', 'inexistente'] },
    ])
    expect(rcte?.provisions.map((provision) => provision.stableKey)).toEqual([
      'go:rcte:art:76:par:6',
    ])
    expect(rcte?.provisions[0]?.parent).toBeUndefined()
    expect(await reader.readDocuments([])).toEqual([])
  })

  it('devolve a cobertura no formato do coverage.json', async () => {
    const reader = createPgFixtureCorpusReader(connection.db)
    const original = fixtureCoverageSchema.parse(
      JSON.parse(readFileSync(`${FIXTURE_DIR}/coverage.json`, 'utf8')),
    )
    const families = original.map((entry) => entry.family)
    const read = fixtureCoverageSchema.parse(await reader.readCoverage(families))
    const byFamily = (entries: typeof original) =>
      [...entries].sort((a, b) => a.family.localeCompare(b.family))
    expect(byFamily(read)).toEqual(byFamily(original))
  })
})
