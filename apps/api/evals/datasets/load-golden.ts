import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { type GoldenCase, goldenDatasetSchema } from './schema.ts'

/**
 * Conjuntos do golden (ADR 0031). O `dev` (50 casos) é onde se ajusta busca, reranker e limites; ele
 * roda na fixture do PR e no `corpus-eval`. O `holdout` nunca orienta parâmetros: roda só no
 * `corpus-eval`, contra o corpus real do staging, e decide a meta de MRR da F4.
 */
export const GoldenSplit = {
  Dev: 'dev',
  Holdout: 'holdout',
} as const
export type GoldenSplit = (typeof GoldenSplit)[keyof typeof GoldenSplit]

const SPLIT_FILES: Readonly<Record<GoldenSplit, string>> = {
  dev: 'golden.yaml',
  holdout: 'holdout.yaml',
}

/** Caminho versionado de cada conjunto (o CODEOWNERS cobre `apps/api/evals/datasets/`). */
export function goldenPath(split: GoldenSplit): string {
  return fileURLToPath(new URL(`./${SPLIT_FILES[split]}`, import.meta.url))
}

export function loadGolden(path: string = goldenPath(GoldenSplit.Dev)): GoldenCase[] {
  return goldenDatasetSchema.parse(parse(readFileSync(path, 'utf8')))
}
