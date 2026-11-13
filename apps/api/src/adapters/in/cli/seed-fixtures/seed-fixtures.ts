import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compareIsoDates, type IsoDate, type ValidityInterval } from '@teko/shared/vigencia'
import type { DeclaredCoverage } from '#app/ports/fixture-corpus-store.ts'
import type {
  SeedFixtureCorpus,
  SeedFixtureCorpusResult,
} from '#app/use-cases/seed-fixture-corpus.ts'
import { Family } from '#domain/corpus/family.ts'
import type { ParsedSource, ParsedVersion } from '#domain/corpus/parsed-source.ts'
import {
  type FixtureCoverage,
  type FixtureDocument,
  fixtureCoverageSchema,
  fixtureDocumentSchema,
} from './fixture-schema.ts'

/**
 * `cli seed-fixtures`: lê a fixture única (`documents/*.json` e `coverage.json`), valida e grava
 * pelo `SeedFixtureCorpus`, o mesmo `IngestDocumentVersion` da ingestão real: cada versão de
 * documento da fixture vira um `ParsedSource`, ingerido na ordem de publicação. Com `replace`, apaga
 * o corpus antes (só para bancos de desenvolvimento, CI e testes).
 */

export const DEFAULT_FIXTURE_DIR = 'test/fixtures/corpus'

export class FixtureFileError extends Error {
  constructor(file: string, cause: unknown) {
    super(`fixture inválida: ${file}`, { cause })
    this.name = 'FixtureFileError'
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function loadFixtureDocuments(dir: string): FixtureDocument[] {
  const documentsDir = join(dir, 'documents')
  return (
    readdirSync(documentsDir)
      .filter((name) => name.endsWith('.json'))
      // Ordem de unidade de código, explícita: independe do locale da máquina.
      .sort((a, b) => (a < b ? -1 : Number(a > b)))
      .map((name) => {
        const file = join(documentsDir, name)
        const parsed = fixtureDocumentSchema.safeParse(readJson(file))
        if (!parsed.success) {
          throw new FixtureFileError(file, parsed.error)
        }
        return parsed.data
      })
  )
}

function loadFixtureCoverage(dir: string): FixtureCoverage {
  const coverageFile = join(dir, 'coverage.json')
  const coverage = fixtureCoverageSchema.safeParse(readJson(coverageFile))
  if (!coverage.success) {
    throw new FixtureFileError(coverageFile, coverage.error)
  }
  return coverage.data
}

/**
 * Famílias consolidadas: cada versão de documento reescreve todo o histórico, como fazem os parsers
 * do RCTE/CTE (`go-html-state-machine`) e das tabelas de Goiás (`sped-tabelas`). Nas demais (Guias e
 * leiautes), a versão reescreve só o próprio período.
 */
const CONSOLIDATED_FAMILIES: ReadonlySet<Family> = new Set([
  Family.Rcte,
  Family.Cte,
  Family.RcteAnexos,
  Family.TabelasGo,
])

const WHOLE_HISTORY: ValidityInterval = { from: null, to: null }

function parsedVersion(version: FixtureDocument['provisions'][number]['versions'][number]) {
  const parsed: ParsedVersion = {
    displayLabel: version.displayLabel,
    validDuring: version.validDuring,
    modality: version.modality,
    validityBasis: version.validityBasis,
    retroactive: version.retroactive,
    reviewStatus: version.reviewStatus,
    text: version.text,
    ...(version.structured === undefined ? {} : { structured: version.structured }),
    ...(version.amendment === undefined ? {} : { amendment: version.amendment }),
  }
  return parsed
}

/**
 * As versões de documento da fixture como a ingestão as recebe: uma por `ParsedSource`, ordenadas
 * por data de publicação (e pela chave, no empate), cada uma com os dispositivos e as redações que
 * a citam em `documentVersions`. O `knowledge` de cada redação sai da ingestão (a partir do
 * `publishedOn` da primeira versão de documento que a traz), como no staging.
 */
export function fixtureSources(documents: readonly FixtureDocument[]): ParsedSource[] {
  return documents.flatMap((doc) =>
    [...doc.versions]
      .sort(
        (a, b) =>
          compareIsoDates(a.publishedOn, b.publishedOn) ||
          (a.key < b.key ? -1 : Number(a.key > b.key)),
      )
      .map((version): ParsedSource => {
        const { key, ...documentVersion } = version
        const provisions = doc.provisions
          .map((provision) => ({
            stableKey: provision.stableKey,
            kind: provision.kind,
            ...(provision.parent === undefined ? {} : { parent: provision.parent }),
            sortPath: provision.sortPath,
            headingPath: provision.headingPath,
            versions: provision.versions
              .filter((candidate) => candidate.documentVersions.includes(key))
              .map(parsedVersion),
          }))
          .filter((provision) => provision.versions.length > 0)
        return {
          document: {
            slug: doc.slug,
            family: doc.family,
            title: doc.title,
            issuer: doc.issuer,
            sourceUrl: doc.sourceUrl,
          },
          version: documentVersion,
          replacementWindow: CONSOLIDATED_FAMILIES.has(doc.family)
            ? WHOLE_HISTORY
            : documentVersion.validDuring,
          provisions,
          skipped: [],
          stats: { notesTotal: 0, notesParsed: 0, notesToReview: 0 },
        }
      }),
  )
}

function declaredCoverage(coverage: FixtureCoverage): DeclaredCoverage[] {
  return coverage.map((entry) => ({
    family: entry.family,
    covered: entry.covered,
    verifiedAt: entry.verifiedAt,
    gaps: entry.gaps.map((gap) => gap.interval),
    gapReason: entry.gaps.map((gap) => gap.reason).join('; ') || null,
  }))
}

export interface FixtureSeedOptions {
  readonly replace: boolean
  readonly gitSha: string
  /** `verified_at` das famílias sem cobertura declarada (padrão: o maior declarado, ou hoje). */
  readonly today: IsoDate
}

export function loadFixtureCommand(dir: string, options: FixtureSeedOptions) {
  const coverage = declaredCoverage(loadFixtureCoverage(dir))
  const verifiedAt =
    coverage
      .map((entry) => entry.verifiedAt)
      .sort(compareIsoDates)
      .at(-1) ?? options.today
  return {
    sources: fixtureSources(loadFixtureDocuments(dir)),
    coverage,
    verifiedAt,
    gitSha: options.gitSha,
    replace: options.replace,
  }
}

export function seedFixtures(
  seed: SeedFixtureCorpus,
  dir: string,
  options: FixtureSeedOptions,
): Promise<SeedFixtureCorpusResult> {
  return seed(loadFixtureCommand(dir, options))
}
