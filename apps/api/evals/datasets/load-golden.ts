import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { type GoldenCase, goldenDatasetSchema } from './schema.ts'

/** Caminho do dataset golden (versionado; o CODEOWNERS cobre `apps/api/evals/datasets/`). */
const GOLDEN_PATH = fileURLToPath(new URL('./golden.yaml', import.meta.url))

export function loadGolden(path: string = GOLDEN_PATH): GoldenCase[] {
  return goldenDatasetSchema.parse(parse(readFileSync(path, 'utf8')))
}
