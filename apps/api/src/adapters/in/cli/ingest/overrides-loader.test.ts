import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DuplicateOverrideError, overrideKey } from '#domain/corpus/overrides.ts'
import { repoPath } from '../../../../../test/setup/repo-root.ts'
import { loadOverrides, OverrideFileError } from './overrides-loader.ts'

const ENTRY = `- stable_key: go:rcte:art:76:par:6
  note_hash: ${'a'.repeat(64)}
  action: set_interval
  valid_during: { from: 2004-11-04, to: 2009-11-24 }
  reason: conferido no DOE
  reviewed_by: mantenedor
  reviewed_at: 2026-11-11
`

describe('loadOverrides', () => {
  it('pasta ausente ou vazia não tem overrides', () => {
    expect(loadOverrides(join(tmpdir(), 'teko-nao-existe-overrides')).size).toBe(0)
    const dir = mkdtempSync(join(tmpdir(), 'teko-overrides-'))
    writeFileSync(join(dir, 'vazio.yaml'), '')
    expect(loadOverrides(dir).size).toBe(0)
  })

  it('lê os arquivos .yaml, ignora os que começam com _ e indexa pela chave', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teko-overrides-'))
    writeFileSync(join(dir, 'rcte.yaml'), ENTRY)
    writeFileSync(join(dir, '_exemplo.yaml'), ENTRY)
    writeFileSync(join(dir, 'notas.txt'), 'ignorado')
    const overrides = loadOverrides(dir)
    expect(overrides.size).toBe(1)
    expect(overrides.get(overrideKey('go:rcte:art:76:par:6', 'a'.repeat(64)))).toMatchObject({
      action: 'set_interval',
      valid_during: { from: '2004-11-04', to: '2009-11-24' },
    })
  })

  it('recusa arquivo inválido e chave repetida entre arquivos', () => {
    const invalid = mkdtempSync(join(tmpdir(), 'teko-overrides-'))
    writeFileSync(join(invalid, 'a.yaml'), '- stable_key: x\n  action: approve\n')
    expect(() => loadOverrides(invalid)).toThrow(OverrideFileError)
    const twice = mkdtempSync(join(tmpdir(), 'teko-overrides-'))
    writeFileSync(join(twice, 'a.yaml'), ENTRY)
    writeFileSync(join(twice, 'b.yml'), ENTRY)
    expect(() => loadOverrides(twice)).toThrow(DuplicateOverrideError)
  })

  it('os overrides versionados em corpus/overrides e o exemplo são válidos', () => {
    const dir = repoPath('corpus', 'overrides')
    // rcte.yaml e cte.yaml (triagem de 2026-11-13); o `_exemplo.yaml` fica de fora.
    expect(loadOverrides(dir).size).toBe(28)
    const copy = mkdtempSync(join(tmpdir(), 'teko-overrides-'))
    const example = repoPath('corpus', 'overrides', '_exemplo.yaml')
    writeFileSync(join(copy, 'exemplo.yaml'), readFileSync(example, 'utf8'))
    expect(loadOverrides(copy).size).toBe(3)
  })
})
