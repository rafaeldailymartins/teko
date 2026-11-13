import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cliPath } from './cli-path.ts'

describe('cliPath', () => {
  const base = resolve('/tmp/teko-api')

  it('resolve caminhos dentro do diretório de trabalho', () => {
    expect(cliPath('reports/retrieval-evals.json', base)).toBe(
      join(base, 'reports', 'retrieval-evals.json'),
    )
    expect(cliPath(join(base, 'reports', 'x.json'), base)).toBe(join(base, 'reports', 'x.json'))
  })

  it('recusa caminhos que saem do diretório de trabalho', () => {
    expect(() => cliPath('../segredo.json', base)).toThrow(/fora do diretório de trabalho/)
    expect(() => cliPath('reports/../../x', base)).toThrow(/fora do diretório de trabalho/)
    expect(() => cliPath(resolve('/etc/passwd'), base)).toThrow(/fora do diretório de trabalho/)
    expect(() => cliPath('.', base)).toThrow(/fora do diretório de trabalho/)
  })

  it('usa o diretório atual por padrão', () => {
    expect(cliPath('reports/a.json')).toBe(join(process.cwd(), 'reports', 'a.json'))
  })
})
