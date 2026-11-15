import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertWithinBudget,
  BundleBudgetError,
  measureFirstLoad,
  readBudget,
} from './bundle-budget.ts'
import type { ParsedDocument } from './html.ts'

const WEB_DIR = fileURLToPath(new URL('../..', import.meta.url))

const page = (...firstLoadScripts: string[]): ParsedDocument => ({
  inlineScripts: [],
  inlineStyles: [],
  firstLoadScripts,
})

let out: string

function chunk(name: string, content: string): number {
  mkdirSync(join(out, '_next', 'static', 'chunks'), { recursive: true })
  writeFileSync(join(out, '_next', 'static', 'chunks', name), content)
  return gzipSync(Buffer.from(content)).length
}

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'teko-web-budget-'))
})

afterEach(() => {
  rmSync(out, { recursive: true, force: true })
})

describe('measureFirstLoad', () => {
  it('soma o gzip da união dos chunks das páginas, cada um uma vez', () => {
    const a = chunk('a.js', 'a'.repeat(5000))
    const b = chunk('b.js', 'console.log("b")')
    const measure = measureFirstLoad(
      out,
      new Map([
        ['en/index.html', page('/_next/static/chunks/a.js', '/_next/static/chunks/b.js?v=1')],
        ['pt-BR/index.html', page('/_next/static/chunks/a.js', 'https://cdn.example/x.js')],
      ]),
    )
    expect(measure.totalGzipBytes).toBe(a + b)
    expect(measure.chunks.map((entry) => entry.file).sort()).toEqual([
      '_next/static/chunks/a.js',
      '_next/static/chunks/b.js',
    ])
  })

  it('falha se uma página referencia um chunk que não existe', () => {
    expect(() =>
      measureFirstLoad(out, new Map([['x.html', page('/_next/static/chunks/sumiu.js')]])),
    ).toThrow(/sumiu\.js é referenciado/)
  })
})

describe('orçamento', () => {
  it('passa no limite e falha acima dele, citando os maiores chunks', () => {
    const measure = { totalGzipBytes: 2048, chunks: [{ file: 'a.js', gzipBytes: 2048 }] }
    expect(() => assertWithinBudget(measure, { firstLoadJsGzipKiB: 2 })).not.toThrow()
    expect(() => assertWithinBudget(measure, { firstLoadJsGzipKiB: 1 })).toThrow(
      /2\.0 KiB gz, acima do orçamento de 1 KiB .*a\.js \(2\.0 KiB\)/,
    )
  })

  it('lê o limite versionado e recusa valor inválido', () => {
    expect(readBudget(join(WEB_DIR, 'bundle-budget.json')).firstLoadJsGzipKiB).toBeGreaterThan(0)
    const file = join(out, 'budget.json')
    for (const value of ['{"firstLoadJsGzipKiB":0}', '{"firstLoadJsGzipKiB":"100"}', '{}']) {
      writeFileSync(file, value)
      expect(() => readBudget(file)).toThrow(BundleBudgetError)
    }
  })
})
