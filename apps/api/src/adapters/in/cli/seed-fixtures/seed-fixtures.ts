import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CorpusWriteResult } from '#app/ports/corpus-writer.ts'
import type { WriteCorpus, WriteCorpusCommand } from '#app/use-cases/write-corpus.ts'
import {
  type FixtureDocument,
  fixtureCoverageSchema,
  fixtureDocumentSchema,
} from './fixture-schema.ts'

/**
 * `cli seed-fixtures`: lê a fixture única (`documents/*.json` e `coverage.json`), valida e grava
 * pelo `WriteCorpus` (o mesmo caminho da ingestão), numa transação. Com `replace`, apaga o corpus
 * antes (só para bancos de desenvolvimento, CI e testes).
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
  return readdirSync(documentsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = join(documentsDir, name)
      const parsed = fixtureDocumentSchema.safeParse(readJson(file))
      if (!parsed.success) {
        throw new FixtureFileError(file, parsed.error)
      }
      return parsed.data
    })
}

export function loadFixtureCommand(
  dir: string,
  options: { readonly replace: boolean },
): WriteCorpusCommand {
  const coverageFile = join(dir, 'coverage.json')
  const coverage = fixtureCoverageSchema.safeParse(readJson(coverageFile))
  if (!coverage.success) {
    throw new FixtureFileError(coverageFile, coverage.error)
  }
  return {
    documents: loadFixtureDocuments(dir),
    coverage: coverage.data,
    notes: `fixture ${dir}`,
    replace: options.replace,
  }
}

export async function seedFixtures(
  writeCorpus: WriteCorpus,
  dir: string,
  options: { readonly replace: boolean },
): Promise<CorpusWriteResult> {
  return writeCorpus(loadFixtureCommand(dir, options))
}
