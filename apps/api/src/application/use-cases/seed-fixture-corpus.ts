import type { IsoDate } from '@teko/shared/vigencia'
import type { ParsedSource } from '#domain/corpus/parsed-source.ts'
import type { DeclaredCoverage, FixtureCorpusStore } from '../ports/fixture-corpus-store.ts'
import { IngestionRunStatus, IngestionTarget } from '../ports/ingestion-run-repository.ts'
import type { IngestDocumentVersion } from './ingest-document-version.ts'
import type { FinishIngestionRun, StartIngestionRun } from './ingestion-run.ts'
import type { RefreshCoverage } from './refresh-coverage.ts'

/**
 * `SeedFixtureCorpus`: grava a fixture única pelo mesmo caminho da ingestão real
 * (`IngestDocumentVersion`, uma versão de documento por vez, na ordem de publicação), num run
 * `target='fixture'`. Depois, o `RefreshCoverage` abre a `corpus_version` e carimba os chunks, e a
 * cobertura declarada da fixture é gravada por cima da derivada.
 *
 * Rodar de novo sobre o mesmo banco não duplica nada: cada versão de documento já publicada sai
 * `unchanged` (sha256 e revisão), e o `RefreshCoverage` sem versão nova não grava outra
 * `corpus_version`.
 */

/** Revisão de parser das versões gravadas pelo seed (a fixture não passa por parser). */
export const FIXTURE_PARSER_REVISION = 1

interface SeedFixtureCorpusCommand {
  /** Versões de documento, já na ordem de ingestão. */
  readonly sources: readonly ParsedSource[]
  readonly coverage: readonly DeclaredCoverage[]
  /** `verified_at` do `RefreshCoverage` das famílias sem cobertura declarada. */
  readonly verifiedAt: IsoDate
  readonly gitSha: string
  /** Esvazia o corpus antes (só desenvolvimento, CI e testes). */
  readonly replace: boolean
}

export interface SeedFixtureCorpusResult {
  readonly runId: string
  readonly corpusVersion: number
  readonly documentVersions: number
  /** Versões de documento que já estavam publicadas (seed repetido). */
  readonly unchanged: number
  readonly provisionVersions: number
  readonly chunks: number
}

export type SeedFixtureCorpus = (
  command: SeedFixtureCorpusCommand,
) => Promise<SeedFixtureCorpusResult>

export class FixtureSeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FixtureSeedError'
  }
}

export interface SeedFixtureCorpusDeps {
  readonly startIngestionRun: StartIngestionRun
  readonly ingestDocumentVersion: IngestDocumentVersion
  readonly refreshCoverage: RefreshCoverage
  readonly finishIngestionRun: FinishIngestionRun
  readonly store: FixtureCorpusStore
}

async function ingestAll(
  deps: SeedFixtureCorpusDeps,
  runId: string,
  sources: readonly ParsedSource[],
) {
  let unchanged = 0
  let provisionVersions = 0
  let chunks = 0
  for (const source of sources) {
    const result = await deps.ingestDocumentVersion({
      runId,
      source,
      blobRaw: null,
      blobDocling: null,
      parserRevision: FIXTURE_PARSER_REVISION,
      // A fixture é sintética: o disjuntor de mudança em massa não se aplica a ela.
      acceptChurn: true,
    })
    if (result.status === 'budget_exhausted') {
      throw new FixtureSeedError(
        `orçamento de neurons esgotado em ${source.document.slug} ${source.version.versionLabel}`,
      )
    }
    if (result.status === 'unchanged') {
      unchanged += 1
    } else {
      provisionVersions += result.provisionVersionsNew
      chunks += result.chunksNew
    }
  }
  return { unchanged, provisionVersions, chunks }
}

export function createSeedFixtureCorpus(deps: SeedFixtureCorpusDeps): SeedFixtureCorpus {
  return async (command) => {
    if (command.replace) {
      await deps.store.clearCorpus()
    }
    const { runId } = await deps.startIngestionRun({
      target: IngestionTarget.Fixture,
      gitSha: command.gitSha,
    })
    try {
      const counts = await ingestAll(deps, runId, command.sources)
      const { corpusVersion } = await deps.refreshCoverage({
        runId,
        verifiedAt: command.verifiedAt,
      })
      await deps.store.declareCoverage(command.coverage)
      const result = {
        runId,
        corpusVersion,
        documentVersions: command.sources.length,
        ...counts,
      }
      await deps.finishIngestionRun({
        runId,
        status: IngestionRunStatus.Succeeded,
        report: { ...result },
      })
      return result
    } catch (error) {
      await deps
        .finishIngestionRun({
          runId,
          status: IngestionRunStatus.Failed,
          report: { error: error instanceof Error ? error.message : String(error) },
        })
        .catch(() => {})
      throw error
    }
  }
}
