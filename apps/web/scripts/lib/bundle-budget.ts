import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { ParsedDocument } from './html.ts'

/**
 * Orçamento de bundle total (`docs/architecture/frontend.md`, "Analytics e orçamentos"): o JS do
 * primeiro acesso, em gzip, somado sobre a união das páginas do export. Cada chunk conta uma vez,
 * mesmo que várias páginas o carreguem; ficam de fora o polyfill `nomodule` e os chunks carregados
 * sob demanda (`import()`), que não pesam no primeiro acesso. O limite fica em
 * `apps/web/bundle-budget.json`.
 */

export interface BundleBudget {
  /** Teto do JS do primeiro acesso, em KiB de gzip. */
  readonly firstLoadJsGzipKiB: number
}

export interface FirstLoadMeasure {
  /** Soma do gzip dos chunks, em bytes. */
  readonly totalGzipBytes: number
  /** Cada chunk (caminho relativo ao export) e o tamanho em gzip, do maior para o menor. */
  readonly chunks: readonly { readonly file: string; readonly gzipBytes: number }[]
}

export class BundleBudgetError extends Error {}

/** Só os chunks do próprio build entram: outra origem já seria barrada pela CSP. */
/** Caminho sem query string nem fragmento (`/_next/static/x.js?v=1` → `/_next/static/x.js`). */
function pathOf(src: string): string {
  const end = src.search(/[?#]/)
  return end === -1 ? src : src.slice(0, end)
}

/** Chunk do Next servido pelo próprio export (`/_next/static/` e `.js`). */
function isNextStaticScript(src: string): boolean {
  const path = pathOf(src)
  return path.startsWith('/_next/static/') && path.endsWith('.js')
}

export function readBudget(file: string): BundleBudget {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const value: unknown = Reflect.get(Object(parsed), 'firstLoadJsGzipKiB')
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new BundleBudgetError(`${file}: firstLoadJsGzipKiB precisa ser um número positivo`)
  }
  return { firstLoadJsGzipKiB: value }
}

export function measureFirstLoad(
  outDir: string,
  documents: ReadonlyMap<string, ParsedDocument>,
): FirstLoadMeasure {
  const files = new Set<string>()
  for (const document of documents.values()) {
    for (const src of document.firstLoadScripts) {
      if (isNextStaticScript(src)) {
        files.add(pathOf(src).slice(1))
      }
    }
  }
  const chunks = [...files].map((file) => {
    const path = join(outDir, file)
    if (!existsSync(path)) {
      throw new BundleBudgetError(`${file} é referenciado por uma página, mas não existe no export`)
    }
    return { file, gzipBytes: gzipSync(readFileSync(path)).length }
  })
  chunks.sort((a, b) => b.gzipBytes - a.gzipBytes || (a.file < b.file ? -1 : 1))
  return { totalGzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0), chunks }
}

/** Falha se o primeiro acesso passar do orçamento. */
export function assertWithinBudget(measure: FirstLoadMeasure, budget: BundleBudget): void {
  const limit = budget.firstLoadJsGzipKiB * 1024
  if (measure.totalGzipBytes > limit) {
    const top = measure.chunks
      .slice(0, 5)
      .map((chunk) => `${chunk.file} (${(chunk.gzipBytes / 1024).toFixed(1)} KiB)`)
      .join(', ')
    throw new BundleBudgetError(
      `JS do primeiro acesso com ${(measure.totalGzipBytes / 1024).toFixed(1)} KiB gz, acima do orçamento de ${budget.firstLoadJsGzipKiB} KiB (apps/web/bundle-budget.json). Maiores: ${top}`,
    )
  }
}
