import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { Family } from '#domain/corpus/family.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import { CliUsageError, EXIT_OK, errorMessage } from '../ingest/cli-common.ts'
import {
  type FixtureDocument,
  fixtureCoverageSchema,
  fixtureDocumentSchema,
} from '../seed-fixtures/fixture-schema.ts'
import { DEFAULT_FIXTURE_DIR, loadFixtureDocuments } from '../seed-fixtures/seed-fixtures.ts'

/**
 * `cli eval-fixture export --from staging --out <dir> [--fixture <dir>]`: regenera os excertos da
 * fixture única (`documents/<slug>.json` e `coverage.json`) a partir do corpus ingerido no
 * staging, limitado aos documentos e dispositivos que a fixture atual já tem. Assim a fixture
 * passa a ser saída dos parsers da F3 (e não da curadoria manual da F2), sem crescer: o golden e
 * as retrieval evals continuam valendo, e o diff do PR mostra o que a ingestão real mudou.
 *
 * O banco é lido por uma porta própria (`FixtureCorpusReader`), ligada pela raiz de composição
 * com a URL do staging. Os documentos lidos passam pelo mesmo schema do `seed-fixtures`.
 */

const EVAL_FIXTURE_USAGE =
  'uso: cli eval-fixture export --from staging --out <dir> [--fixture <dir da fixture atual>]'

export interface FixtureSelection {
  readonly slug: string
  /** Chaves estáveis a exportar (as da fixture atual). */
  readonly stableKeys: readonly string[]
}

/**
 * Leitura do corpus publicado no formato da fixture (porta de entrada deste subcomando; o adapter
 * Postgres fica com a raiz de composição). Cada documento volta com todas as versões de documento
 * publicadas e, dos dispositivos pedidos, as redações publicáveis com `knowledge` aberto.
 */
export interface FixtureCorpusReader {
  readDocuments(selection: readonly FixtureSelection[]): Promise<readonly unknown[]>
  readCoverage(families: readonly Family[]): Promise<unknown>
}

export interface EvalFixtureDeps {
  readonly reader: FixtureCorpusReader
  /** Saída de uma linha (o `cli.ts` passa `console.log`). */
  readonly print: (line: string) => void
}

export interface EvalFixtureArgs {
  readonly from: 'staging'
  readonly out: string
  readonly fixture: string
}

export function parseEvalFixtureArgs(args: readonly string[]): EvalFixtureArgs {
  const [subcommand, ...rest] = args
  if (subcommand !== 'export') {
    throw new CliUsageError(
      `subcomando desconhecido: ${subcommand ?? '(nenhum)'}`,
      EVAL_FIXTURE_USAGE,
    )
  }
  let values: { from?: string; out?: string; fixture?: string }
  try {
    values = parseArgs({
      args: rest,
      options: {
        from: { type: 'string' },
        out: { type: 'string' },
        fixture: { type: 'string', default: DEFAULT_FIXTURE_DIR },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new CliUsageError(errorMessage(error), EVAL_FIXTURE_USAGE)
  }
  if (values.from !== 'staging') {
    throw new CliUsageError(
      '--from só aceita staging (o corpus ingerido com embeddings reais)',
      EVAL_FIXTURE_USAGE,
    )
  }
  if (values.out === undefined || values.out.trim() === '') {
    throw new CliUsageError('--out é obrigatório', EVAL_FIXTURE_USAGE)
  }
  return { from: 'staging', out: values.out, fixture: values.fixture ?? DEFAULT_FIXTURE_DIR }
}

export class FixtureExportError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'FixtureExportError'
  }
}

/** Mantém, de cada documento lido, só os dispositivos selecionados, na ordem de `sortPath`. */
export function restrictDocument(
  document: FixtureDocument,
  stableKeys: ReadonlySet<string>,
): FixtureDocument {
  const provisions = document.provisions
    .filter((provision) => stableKeys.has(provision.stableKey))
    .sort(
      (a, b) =>
        compareCodeUnits(a.sortPath, b.sortPath) || compareCodeUnits(a.stableKey, b.stableKey),
    )
  const kept = new Set(provisions.map((provision) => provision.stableKey))
  return {
    ...document,
    provisions: provisions.map((provision) =>
      provision.parent !== undefined && !kept.has(provision.parent)
        ? (({ parent: _parent, ...rest }) => rest)(provision)
        : provision,
    ),
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export async function runEvalFixtureExport(
  deps: EvalFixtureDeps,
  args: readonly string[],
): Promise<number> {
  const parsed = parseEvalFixtureArgs(args)
  const current = loadFixtureDocuments(parsed.fixture)
  const selection: FixtureSelection[] = current.map((document) => ({
    slug: document.slug,
    stableKeys: document.provisions.map((provision) => provision.stableKey),
  }))
  const rawDocuments = await deps.reader.readDocuments(selection)
  const documentsDir = join(parsed.out, 'documents')
  mkdirSync(documentsDir, { recursive: true })
  const summary: { slug: string; provisions: number; missing: number }[] = []
  const exported = new Set<string>()
  for (const raw of rawDocuments) {
    const document = fixtureDocumentSchema.safeParse(raw)
    if (!document.success) {
      throw new FixtureExportError(
        `documento do staging fora do formato da fixture: ${document.error.message}`,
        {
          cause: document.error,
        },
      )
    }
    const wanted = selection.find((entry) => entry.slug === document.data.slug)
    if (wanted === undefined) {
      continue
    }
    const keys = new Set(wanted.stableKeys)
    const restricted = restrictDocument(document.data, keys)
    if (restricted.provisions.length === 0) {
      throw new FixtureExportError(
        `${restricted.slug}: nenhum dispositivo da fixture atual no staging`,
      )
    }
    // Revalida: a restrição pode ter deixado versão de documento sem uso, o que o schema aceita.
    writeJson(
      join(documentsDir, `${restricted.slug}.json`),
      fixtureDocumentSchema.parse(restricted),
    )
    exported.add(restricted.slug)
    summary.push({
      slug: restricted.slug,
      provisions: restricted.provisions.length,
      missing: keys.size - restricted.provisions.length,
    })
  }
  const absent = selection.filter((entry) => !exported.has(entry.slug)).map((entry) => entry.slug)
  if (absent.length > 0) {
    throw new FixtureExportError(`documentos da fixture ausentes do staging: ${absent.join(', ')}`)
  }
  const families = [...new Set(current.map((document) => document.family))]
  const coverage = fixtureCoverageSchema.safeParse(await deps.reader.readCoverage(families))
  if (!coverage.success) {
    throw new FixtureExportError(
      `cobertura do staging fora do formato: ${coverage.error.message}`,
      {
        cause: coverage.error,
      },
    )
  }
  writeJson(
    join(parsed.out, 'coverage.json'),
    coverage.data.filter((entry) => families.includes(entry.family)),
  )
  deps.print(JSON.stringify({ out: parsed.out, documents: summary }))
  return EXIT_OK
}
