import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { repoPath } from '../../../../../test/setup/repo-root.ts'
import { doclingBlobKey, EXTRACTOR_DOCLING_VERSION, EXTRACTOR_REVISION } from './blob-keys.ts'

const parts = {
  family: 'efd-icms-ipi',
  documentSlug: 'guia-pratico-efd-icms-ipi',
  version: '3.2.4',
  sha256: 'a'.repeat(64),
} as const

describe('EXTRACTOR_REVISION', () => {
  it('a revisão 1 é a chave atual, sem sufixo (o cache gravado continua válido)', () => {
    expect(doclingBlobKey(parts, '1-125', 1)).toBe(
      `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${'a'.repeat(64)}-p1-125.json`,
    )
    expect(doclingBlobKey(parts, null, 2)).toBe(
      `efd-icms-ipi/guia-pratico-efd-icms-ipi/3.2.4/${'a'.repeat(64)}.x2.json`,
    )
    expect(doclingBlobKey(parts, null)).toBe(doclingBlobKey(parts, null, EXTRACTOR_REVISION))
  })

  it('é a mesma do tools/ingest (manifest.py)', () => {
    const manifest = readFileSync(
      repoPath('tools', 'ingest', 'src', 'teko_ingest', 'manifest.py'),
      'utf8',
    )
    expect(/^EXTRACTOR_REVISION: Final = (\d+)$/mu.exec(manifest)?.[1]).toBe(
      String(EXTRACTOR_REVISION),
    )
    expect(/^EXTRACTOR_DOCLING_VERSION: Final = "([^"]+)"$/mu.exec(manifest)?.[1]).toBe(
      EXTRACTOR_DOCLING_VERSION,
    )
  })

  it('falha se a versão do docling no uv.lock mudar sem a revisão do extrator mudar', () => {
    const lock = readFileSync(repoPath('tools', 'ingest', 'uv.lock'), 'utf8')
    const locked = /\[\[package\]\]\r?\nname = "docling"\r?\nversion = "([^"]+)"/u.exec(lock)?.[1]
    // Docling novo muda a saída do mesmo PDF: suba EXTRACTOR_REVISION (aqui e no manifest.py) e
    // atualize EXTRACTOR_DOCLING_VERSION; o próximo ingest reextrai as partes.
    expect(locked).toBe(EXTRACTOR_DOCLING_VERSION)
  })
})
