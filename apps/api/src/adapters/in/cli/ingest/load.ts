import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import type { IsoDate } from '@teko/shared/vigencia'
import { type BlobStore, BlobStoreName } from '#app/ports/blob-store.ts'
import type { ContentHasher } from '#app/ports/content-hasher.ts'
import { DatabaseSizeLimitError } from '#app/ports/database-usage.ts'
import type { ExportSnapshot } from '#app/use-cases/export-snapshot.ts'
import {
  type IngestDocumentVersion,
  reviewNoteHash,
} from '#app/use-cases/ingest-document-version.ts'
import type { FinishIngestionRun, StartIngestionRun } from '#app/use-cases/ingestion-run.ts'
import type { RefreshCoverage } from '#app/use-cases/refresh-coverage.ts'
import { applyOverrides, type Override } from '#domain/corpus/overrides.ts'
import type { ParsedSource } from '#domain/corpus/parsed-source.ts'
import { compareCodeUnits } from '#domain/shared/compare-code-units.ts'
import { doclingBlobKey, rawBlobKey, type SourceKeyParts, slugify } from './blob-keys.ts'
import {
  CliUsageError,
  EXIT_BUDGET_EXHAUSTED,
  EXIT_FAILURE,
  EXIT_OK,
  errorMessage,
  IngestTarget,
  isIngestTarget,
  sha256Hex,
} from './cli-common.ts'
import { type CorpusLock, nextCorpusLock, readCorpusLock, writeCorpusLock } from './corpus-lock.ts'
import type { Parser, ParserName } from './parsers/parser.ts'
import { type Plan, type PlanItem, planSchema } from './plan.ts'
import type { CorpusConfig, ResolvedSource } from './sources.ts'
import { SourceFormat } from './sources.ts'
import { readZip } from './zip.ts'

/**
 * `cli ingest load --target staging|production --plan <dir>/plan.json --docling-dir <dir>
 * [--bulk] [--migrate] [--report <arquivo>] [--lock <arquivo>]` (job `load` do `ingest.yml`).
 *
 * 1. `--migrate` (só staging; desvio consciente da F3) aplica as migrações antes de tudo;
 * 2. abre o run (`startIngestionRun`, com `bulk`);
 * 3. por documento, as versões em ordem de `published_on`: lê o arquivo do plano (sha256
 *    conferido), as partes do Docling (da pasta do `extract` ou, se já estavam lá, do store
 *    `corpus-docling`) e os membros do zip; resolve o descritor, parseia, aplica os overrides,
 *    grava raw e docling no Blobs e chama `ingestDocumentVersion`;
 * 4. orçamento esgotado → para, recalcula a cobertura do que já publicou, fecha o run como
 *    `budget_exhausted` e sai com 75 (o próximo run retoma pelo `embedding_cache`);
 * 5. no fim, `refreshCoverage`; se a versão do corpus mudou, `exportSnapshot` e atualização do
 *    `corpus/corpus.lock.json`; fecha o run com o relatório (também gravado em `--report`).
 *
 * Uma fonte que falha (parse, Docling ausente, sha256 divergente) não impede as outras: o run fecha
 * como `failed`, sem snapshot nem lock, e o código de saída é 1.
 */

const LOAD_USAGE = [
  'uso: cli ingest load --target staging|production --plan <plan.json> --docling-dir <dir>',
  '       [--bulk] [--migrate] [--report <arquivo>] [--lock <corpus.lock.json>]',
].join('\n')

/** Casos de uso da ingestão que o `load` chama (subconjunto do `IngestionContainer`). */
export interface LoadUseCases {
  readonly startIngestionRun: StartIngestionRun
  readonly finishIngestionRun: FinishIngestionRun
  readonly ingestDocumentVersion: IngestDocumentVersion
  readonly refreshCoverage: RefreshCoverage
  readonly exportSnapshot: ExportSnapshot
}

type IngestDocumentVersionResult = Awaited<ReturnType<IngestDocumentVersion>>

export interface IngestLoadDeps {
  readonly config: CorpusConfig
  readonly blobs: BlobStore
  readonly parsers: Readonly<Record<ParserName, Parser>>
  /** Revisão de cada parser (`PARSER_REVISIONS`, ADR 0026). */
  readonly parserRevisions: Readonly<Record<ParserName, number>>
  /** Resoluções de `corpus/overrides/` (chave `(stable_key, note_hash)`). */
  readonly overrides: ReadonlyMap<string, Override>
  /** O mesmo hasher do `IngestDocumentVersion` (o `note_hash` precisa bater com a fila). */
  readonly hasher: ContentHasher
  readonly useCases: LoadUseCases
  /** Aplica as migrações (só com `--migrate --target staging`). */
  readonly migrate: () => Promise<void>
  readonly gitSha: string
  /** Data do run em `America/Sao_Paulo` (`verified_at` da cobertura e `updatedAt` do lock). */
  readonly today: () => IsoDate
  /** `corpus/corpus.lock.json` padrão (relativo ao repositório). */
  readonly defaultLockFile: string
  /** Saída de uma linha (o `cli.ts` passa `console.log`). */
  readonly print: (line: string) => void
}

export interface LoadArgs {
  readonly target: IngestTarget
  readonly plan: string
  readonly doclingDir: string
  readonly bulk: boolean
  readonly migrate: boolean
  readonly report: string | null
  readonly lock: string | null
}

export function parseLoadArgs(args: readonly string[]): LoadArgs {
  let values: {
    target?: string
    plan?: string
    'docling-dir'?: string
    bulk?: boolean
    migrate?: boolean
    report?: string
    lock?: string
  }
  try {
    values = parseArgs({
      args: [...args],
      options: {
        target: { type: 'string' },
        plan: { type: 'string' },
        'docling-dir': { type: 'string' },
        bulk: { type: 'boolean', default: false },
        migrate: { type: 'boolean', default: false },
        report: { type: 'string' },
        lock: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    throw new CliUsageError(errorMessage(error), LOAD_USAGE)
  }
  if (!isIngestTarget(values.target)) {
    throw new CliUsageError('--target precisa ser staging ou production', LOAD_USAGE)
  }
  if (values.plan === undefined || values['docling-dir'] === undefined) {
    throw new CliUsageError('--plan e --docling-dir são obrigatórios', LOAD_USAGE)
  }
  const target = values.target
  const bulk = values.bulk === true
  const migrate = values.migrate === true
  if (target !== IngestTarget.Staging && (bulk || migrate)) {
    throw new CliUsageError(
      '--bulk e --migrate só valem com --target staging (produção recebe o corpus pelo promote)',
      LOAD_USAGE,
    )
  }
  return {
    target,
    plan: values.plan,
    doclingDir: values['docling-dir'],
    bulk,
    migrate,
    report: values.report ?? null,
    lock: values.lock ?? null,
  }
}

class PlanFileError extends Error {
  constructor(file: string, detail: string, options?: { readonly cause?: unknown }) {
    super(`plan.json inválido (${file}): ${detail}`, options)
    this.name = 'PlanFileError'
  }
}

function readPlan(file: string, target: IngestTarget): Plan {
  const parsed = planSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')))
  if (!parsed.success) {
    throw new PlanFileError(file, parsed.error.message, { cause: parsed.error })
  }
  if (parsed.data.target !== target) {
    throw new PlanFileError(file, `plano de ${parsed.data.target}, load com --target ${target}`)
  }
  return parsed.data
}

/** Relatório do run (`--report` e `ingestion_runs.report`). */
type LoadReport = {
  runId: string
  target: IngestTarget
  planErrors: readonly { sourceId: string; message: string }[]
  status?: 'succeeded' | 'failed' | 'budget_exhausted'
  items?: readonly ItemOutcome[]
  chunksNew?: number
  neurons?: number
  provisionVersionsNew?: number
  reviewItems?: number
  /** Versões já publicadas com revisão menor do parser, reprocessadas neste run. */
  reprocessed?: number
  /** `pg_database_size` no fechamento do run. */
  dbBytes?: number
  /** CU-segundos do projeto Neon durante o run (null sem a API do Neon). */
  cuSeconds?: number | null
  corpusVersion?: number
  manifestKey?: string
  lockChanged?: boolean
  budgetExhaustedAt?: string
  pendingChunks?: number
  error?: string
}

type ItemOutcome =
  | {
      readonly sourceId: string
      readonly sha256: string
      readonly result: IngestDocumentVersionResult
      readonly overridesApplied: number
      readonly versionLabel: string
      readonly publishedOn: IsoDate
    }
  | { readonly sourceId: string; readonly sha256: string; readonly error: string }

interface LoadContext {
  readonly deps: IngestLoadDeps
  readonly args: LoadArgs
  readonly planDir: string
  readonly runId: string
}

/** Ordem de carga: documentos na ordem de `sources.yaml`, versões por `published_on`. */
function loadOrder(items: readonly PlanItem[], config: CorpusConfig): PlanItem[] {
  const position = new Map(config.resolved.map((source, index) => [source.id, index] as const))
  const documentRank = new Map<string, number>()
  for (const source of config.resolved) {
    if (!documentRank.has(source.document.slug)) {
      documentRank.set(source.document.slug, position.get(source.id) ?? 0)
    }
  }
  const publishedOn = (item: PlanItem): string =>
    config.resolved.find((source) => source.id === item.sourceId)?.publishedOn ??
    item.externalTable?.dtVersao ??
    ''
  return [...items].sort(
    (a, b) =>
      (documentRank.get(a.documentSlug) ?? 0) - (documentRank.get(b.documentSlug) ?? 0) ||
      compareCodeUnits(publishedOn(a), publishedOn(b)) ||
      compareCodeUnits(a.sourceId, b.sourceId),
  )
}

async function readDocling(
  context: LoadContext,
  item: PlanItem,
  keys: SourceKeyParts,
): Promise<{ parts: unknown[]; blobKeys: string[] }> {
  const parts: unknown[] = []
  const blobKeys: string[] = []
  for (const part of item.docling) {
    const key = doclingBlobKey(keys, part.pageRange)
    const local = join(context.args.doclingDir, part.id, 'docling.json')
    let bytes: Uint8Array | null = null
    if (existsSync(local)) {
      bytes = new Uint8Array(readFileSync(local))
      await context.deps.blobs.set(BlobStoreName.CorpusDocling, key, bytes)
    } else {
      bytes = await context.deps.blobs.get(BlobStoreName.CorpusDocling, key)
    }
    if (bytes === null) {
      throw new Error(`docling.json da parte ${part.id} ausente da pasta do extract e do Blobs`)
    }
    parts.push(JSON.parse(new TextDecoder().decode(bytes)))
    blobKeys.push(key)
  }
  return { parts, blobKeys }
}

/** Segmento de versão da chave do Blobs para fontes sem rótulo prévio. */
function versionSegment(item: PlanItem, parsed: ParsedSource | null): string {
  if (item.version !== null) {
    return item.version
  }
  if (item.externalTable !== null) {
    return `v${String(item.externalTable.versao)}`
  }
  return parsed === null
    ? item.sha256
    : slugify(parsed.version.versionLabel) || parsed.version.publishedOn
}

async function loadItem(
  context: LoadContext,
  item: PlanItem,
  source: ResolvedSource,
): Promise<ItemOutcome> {
  const bytes = new Uint8Array(readFileSync(join(context.planDir, item.file)))
  if (sha256Hex(bytes) !== item.sha256) {
    throw new Error(`arquivo ${item.file} não confere com o sha256 do plano`)
  }
  const preliminary: SourceKeyParts = {
    family: item.family,
    documentSlug: item.documentSlug,
    version: versionSegment(item, null),
    sha256: item.sha256,
  }
  const docling = await readDocling(context, item, preliminary)
  const members = item.format === SourceFormat.Zip ? readZip(bytes) : new Map<string, Uint8Array>()
  const parser = context.deps.parsers[item.parser]
  const parsed = parser({
    source: { ...source, externalTable: item.externalTable },
    sha256: item.sha256,
    bytes,
    docling: docling.parts,
    members,
  })
  const { source: resolved, applied } = applyOverrides(parsed, context.deps.overrides, (flag) =>
    reviewNoteHash(context.deps.hasher, flag),
  )
  const rawKey = rawBlobKey({ ...preliminary, version: versionSegment(item, parsed) }, item.format)
  const existing = await context.deps.blobs.list(BlobStoreName.CorpusRaw, rawKey)
  if (!existing.includes(rawKey)) {
    await context.deps.blobs.set(BlobStoreName.CorpusRaw, rawKey, bytes)
  }
  const result = await context.deps.useCases.ingestDocumentVersion({
    runId: context.runId,
    source: resolved,
    blobRaw: rawKey,
    blobDocling: docling.blobKeys[0] ?? null,
    parserRevision: context.deps.parserRevisions[item.parser],
  })
  return {
    sourceId: item.sourceId,
    sha256: item.sha256,
    result,
    overridesApplied: applied.length,
    versionLabel: resolved.version.versionLabel,
    publishedOn: resolved.version.publishedOn,
  }
}

function sumPublished(
  outcomes: readonly ItemOutcome[],
  field: 'chunksNew' | 'neurons' | 'provisionVersionsNew' | 'reviewItems',
): number {
  let total = 0
  for (const outcome of outcomes) {
    if ('result' in outcome && outcome.result.status === 'published') {
      total += outcome.result[field]
    }
  }
  return total
}

export async function runIngestLoad(
  deps: IngestLoadDeps,
  args: readonly string[],
): Promise<number> {
  const parsed = parseLoadArgs(args)
  const plan = readPlan(parsed.plan, parsed.target)
  if (parsed.migrate) {
    await deps.migrate()
  }
  const { runId } = await deps.useCases.startIngestionRun({
    target: parsed.target,
    gitSha: deps.gitSha,
    bulk: parsed.bulk,
  })
  const context: LoadContext = { deps, args: parsed, planDir: dirname(parsed.plan), runId }
  const outcomes: ItemOutcome[] = []
  let exhausted: IngestDocumentVersionResult | null = null
  const report: LoadReport = { runId, target: parsed.target, planErrors: plan.errors }
  let finished = false
  const finish = async (
    status: 'succeeded' | 'failed' | 'budget_exhausted',
    exitCode: number,
  ): Promise<number> => {
    finished = true
    Object.assign(report, {
      status,
      items: outcomes,
      chunksNew: sumPublished(outcomes, 'chunksNew'),
      neurons:
        sumPublished(outcomes, 'neurons') +
        (exhausted?.status === 'budget_exhausted' ? exhausted.neurons : 0),
      provisionVersionsNew: sumPublished(outcomes, 'provisionVersionsNew'),
      reviewItems: sumPublished(outcomes, 'reviewItems'),
      reprocessed: outcomes.filter(
        (outcome) =>
          'result' in outcome &&
          outcome.result.status === 'published' &&
          outcome.result.reprocessed,
      ).length,
    })
    // O tamanho do banco e as CU-s vão também para o arquivo do relatório (o resumo do
    // ingest.yml mostra o tamanho contra o alvo de 400 MB do staging).
    const usage = await deps.useCases.finishIngestionRun({ runId, status, report })
    Object.assign(report, { dbBytes: usage.dbBytes, cuSeconds: usage.cuSeconds })
    if (parsed.report !== null) {
      writeFileSync(parsed.report, `${JSON.stringify(report, null, 2)}\n`)
    }
    deps.print(
      JSON.stringify({
        runId,
        status,
        chunksNew: report.chunksNew,
        neurons: report.neurons,
        corpusVersion: report.corpusVersion ?? null,
        dbBytes: usage.dbBytes,
      }),
    )
    return exitCode
  }

  try {
    for (const item of loadOrder(plan.items, deps.config)) {
      const source = deps.config.resolved.find((entry) => entry.id === item.sourceId)
      if (source === undefined) {
        outcomes.push({
          sourceId: item.sourceId,
          sha256: item.sha256,
          error: 'fonte ausente ou desabilitada em corpus/sources.yaml',
        })
        continue
      }
      try {
        const outcome = await loadItem(context, item, source)
        if ('result' in outcome && outcome.result.status === 'budget_exhausted') {
          exhausted = outcome.result
          report.budgetExhaustedAt = item.sourceId
          report.pendingChunks = outcome.result.pendingChunks
          break
        }
        outcomes.push(outcome)
      } catch (error) {
        if (error instanceof DatabaseSizeLimitError) {
          throw error
        }
        outcomes.push({ sourceId: item.sourceId, sha256: item.sha256, error: errorMessage(error) })
      }
    }
    const failed = outcomes.some((outcome) => 'error' in outcome) || plan.errors.length > 0
    // Sem `families`, o caso de uso recalcula só as famílias com versão publicada neste run.
    const { corpusVersion } = await deps.useCases.refreshCoverage({
      runId,
      verifiedAt: deps.today(),
    })
    report.corpusVersion = corpusVersion
    if (exhausted !== null) {
      return await finish('budget_exhausted', EXIT_BUDGET_EXHAUSTED)
    }
    if (failed) {
      return await finish('failed', EXIT_FAILURE)
    }
    const lockFile = parsed.lock ?? deps.defaultLockFile
    const lock: CorpusLock = readCorpusLock(lockFile)
    let snapshot = null
    if (lock.snapshot?.corpusVersion !== corpusVersion) {
      const exported = await deps.useCases.exportSnapshot({ corpusVersion })
      const manifestBytes = await deps.blobs.get(
        BlobStoreName.CorpusSnapshots,
        exported.manifestKey,
      )
      snapshot = {
        manifestKey: exported.manifestKey,
        corpusVersion: exported.manifest.corpusVersion,
        createdAt: exported.manifest.createdAt,
        migration: exported.manifest.migration.hash,
        manifestSha256: sha256Hex(
          manifestBytes ?? new TextEncoder().encode(JSON.stringify(exported.manifest)),
        ),
      }
      report.manifestKey = exported.manifestKey
    }
    const sources: Record<string, { sha256: string; versionLabel: string; publishedOn: IsoDate }> =
      {}
    for (const outcome of outcomes) {
      if ('result' in outcome) {
        sources[outcome.sourceId] = {
          sha256: outcome.sha256,
          versionLabel: outcome.versionLabel,
          publishedOn: outcome.publishedOn,
        }
      }
    }
    const next = nextCorpusLock(lock, { snapshot, sources, today: deps.today() })
    if (next !== null) {
      writeCorpusLock(lockFile, next)
    }
    report.lockChanged = next !== null
    return await finish('succeeded', EXIT_OK)
  } catch (error) {
    report.error =
      error instanceof DatabaseSizeLimitError
        ? `guarda de tamanho do banco: ${error.message} (rode a manutenção ou reduza o corpus antes de continuar)`
        : errorMessage(error)
    if (!finished) {
      await finish('failed', EXIT_FAILURE)
    }
    throw error
  }
}
