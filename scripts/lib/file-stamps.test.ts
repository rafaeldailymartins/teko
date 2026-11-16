import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { FileStamps, listFiles, stampOf } from './file-stamps.ts'

const root = mkdtempSync(join(tmpdir(), 'teko-file-stamps-'))
after(() => rmSync(root, { recursive: true, force: true }))

function fixture(name: string): { dir: string; file: string } {
  const dir = join(root, name)
  mkdirSync(join(dir, 'nested'), { recursive: true })
  const file = join(dir, 'nested', 'server.ts')
  writeFileSync(file, 'export {}\n')
  return { dir, file }
}

describe('carimbos de arquivo do dev-watch', () => {
  it('ler o arquivo não é mudança (o aviso do Windows pela data de acesso)', () => {
    const { dir, file } = fixture('read')
    const stamps = new FileStamps()
    stamps.seed(listFiles(dir))
    readFileSync(file)
    assert.equal(stamps.changed(file), false)
  })

  it('escrever, criar e apagar são mudança, e o aviso repetido não é', () => {
    const { dir, file } = fixture('write')
    const stamps = new FileStamps()
    stamps.seed(listFiles(dir))

    writeFileSync(file, 'export const changed = true\n')
    assert.equal(stamps.changed(file), true)
    assert.equal(stamps.changed(file), false)

    const created = join(dir, 'new.ts')
    writeFileSync(created, 'export {}\n')
    assert.equal(stamps.changed(created), true)

    rmSync(created)
    assert.equal(stamps.changed(created), true)
    assert.equal(stamps.changed(created), false)
  })

  it('diretório não é mudança, e só arquivos entram na lista', () => {
    const { dir, file } = fixture('dir')
    const stamps = new FileStamps()
    stamps.seed(listFiles(dir))
    assert.equal(stamps.changed(join(dir, 'nested')), false)
    assert.deepEqual(listFiles(dir), [file])
    assert.equal(stampOf(join(dir, 'nested')), 'directory')
    assert.equal(stampOf(join(dir, 'missing.ts')), 'missing')
  })
})
