import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  CliGuardError,
  compareCodeUnits,
  findOnSafePath,
  resolveAllowedExecutable,
  resolveInsideRoot,
} from './cli-guards.ts'

/**
 * Guardas dos scripts da raiz (`scripts/*.ts`). Roda com o test runner nativo do Node 24
 * (`pnpm test:scripts` = `node --test`), sem pacote nem dependência: os scripts ficam fora dos três
 * pacotes do workspace, e o `turbo boundaries` proíbe que um pacote importe arquivos de fora dele.
 * Cobre os helpers de `cli-guards.ts` e, de ponta a ponta, a recusa de caminho fora do repositório e
 * de executável fora da allowlist nos próprios scripts.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..', '..')
const IS_WINDOWS = process.platform === 'win32'
const EXE = IS_WINDOWS ? '.exe' : ''
const SEARCH = (pathEnv: string) => ({ pathEnv, platform: process.platform })

let sandbox: string

/** Cria um "executável" vazio (no POSIX com bit de execução). */
function fakeExecutable(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, '')
  chmodSync(file, 0o755)
  return file
}

function runScript(script: string, args: readonly string[]) {
  return spawnSync(process.execPath, [join('scripts', script), ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
}

before(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'teko-root-scripts-')))
})

after(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('compareCodeUnits (S2871: ordem determinística, independente de locale)', () => {
  it('ordena por unidade de código UTF-16: maiúsculas antes de minúsculas, acentos no fim', () => {
    const names = ['b', 'á', 'B', 'a', 'Z', 'A', 'é', 'e', '_x', '10', '9']
    assert.deepEqual(names.toSorted(compareCodeUnits), [
      '10',
      '9',
      'A',
      'B',
      'Z',
      '_x',
      'a',
      'b',
      'e',
      'á',
      'é',
    ])
  })

  it('é uma ordem total coerente com < e >', () => {
    assert.equal(compareCodeUnits('a', 'a'), 0)
    assert.equal(compareCodeUnits('a', 'b'), -1)
    assert.equal(compareCodeUnits('b', 'a'), 1)
    assert.equal(compareCodeUnits('output/z', 'output/Z'), 1)
  })
})

describe('resolveInsideRoot (S8707: path traversal nos argumentos de CLI)', () => {
  let root: string
  let outside: string

  before(() => {
    root = join(sandbox, 'repo')
    outside = join(sandbox, 'outside')
    mkdirSync(join(root, 'nested'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(root, 'nested', 'file.txt'), 'x')
    writeFileSync(join(outside, 'secret.txt'), 'x')
    // `junction` dispensa privilégio no Windows; no POSIX o tipo é ignorado (link de diretório).
    symlinkSync(outside, join(root, 'escape'), 'junction')
    symlinkSync(join(root, 'nested'), join(root, 'inner'), 'junction')
  })

  it('aceita caminhos dentro da raiz, existentes ou não', () => {
    assert.equal(resolveInsideRoot(root, 'nested/file.txt', root), join(root, 'nested', 'file.txt'))
    assert.equal(resolveInsideRoot(root, '.', root), root)
    assert.equal(
      resolveInsideRoot(root, 'dist/new/out.tgz', root),
      join(root, 'dist', 'new', 'out.tgz'),
    )
    assert.equal(
      resolveInsideRoot(root, 'file.txt', join(root, 'nested')),
      join(root, 'nested', 'file.txt'),
    )
    assert.equal(resolveInsideRoot(root, '..dotted', root), join(root, '..dotted'))
    assert.equal(resolveInsideRoot(root, 'inner/file.txt', root), join(root, 'inner', 'file.txt'))
  })

  for (const [candidate, label] of [
    ['..', 'o pai da raiz'],
    ['../outside/secret.txt', 'subida relativa'],
    ['nested/../../outside/secret.txt', 'subida no meio do caminho'],
    ['escape/secret.txt', 'link simbólico/junction para fora'],
    ['escape/nao-existe/out.tgz', 'arquivo novo sob link para fora'],
  ] as const) {
    it(`recusa ${candidate} (${label})`, () => {
      assert.throws(() => resolveInsideRoot(root, candidate, root), CliGuardError)
    })
  }

  it('recusa caminho absoluto fora da raiz e cwd fora da raiz', () => {
    assert.throws(() => resolveInsideRoot(root, join(outside, 'secret.txt'), root), CliGuardError)
    assert.throws(() => resolveInsideRoot(root, 'secret.txt', outside), CliGuardError)
  })

  it('recusa caminho vazio ou com byte nulo', () => {
    assert.throws(() => resolveInsideRoot(root, '', root), CliGuardError)
    assert.throws(() => resolveInsideRoot(root, 'a\0b', root), CliGuardError)
  })

  it('recusa link simbólico pendurado (o write o seguiria para fora)', {
    skip: IS_WINDOWS && 'symlink de arquivo exige privilégio no Windows',
  }, () => {
    symlinkSync(join(outside, 'novo.tgz'), join(root, 'dangling.tgz'))
    assert.throws(() => resolveInsideRoot(root, 'dangling.tgz', root), CliGuardError)
  })
})

describe('findOnSafePath (S4036: PATH só com diretórios absolutos e protegidos)', () => {
  let bin: string

  before(() => {
    bin = join(sandbox, 'bin')
    fakeExecutable(bin, `tool${EXE}`)
  })

  it('acha o executável num diretório absoluto do PATH e devolve o caminho absoluto', () => {
    assert.equal(findOnSafePath('tool', SEARCH(bin)), join(bin, `tool${EXE}`))
  })

  it('ignora entradas relativas e vazias do PATH (resolveriam contra o cwd)', () => {
    const cwdBin = join(sandbox, 'cwd-bin')
    fakeExecutable(cwdBin, `tool${EXE}`)
    const relativeOnly = ['.', '', 'cwd-bin'].join(delimiter)
    assert.throws(() => findOnSafePath('tool', SEARCH(relativeOnly)), CliGuardError)
    assert.equal(
      findOnSafePath('tool', SEARCH(['.', '', bin].join(delimiter))),
      join(bin, `tool${EXE}`),
    )
  })

  for (const name of ['../tool', 'sub/tool', 'sub\\tool', '-tool', 'tool --flag', '']) {
    it(`recusa nome que não é um nome simples: ${JSON.stringify(name)}`, () => {
      assert.throws(() => findOnSafePath(name, SEARCH(bin)), CliGuardError)
    })
  }

  it('falha quando o executável não existe', () => {
    assert.throws(() => findOnSafePath('nao-existe', SEARCH(bin)), CliGuardError)
    assert.throws(
      () => findOnSafePath('tool', { pathEnv: undefined, platform: process.platform }),
      CliGuardError,
    )
  })

  it('ignora diretório gravável por todos e arquivo sem bit de execução', {
    skip: IS_WINDOWS && 'permissões POSIX',
  }, () => {
    const open = join(sandbox, 'world-writable')
    fakeExecutable(open, 'tool')
    chmodSync(open, 0o777)
    assert.throws(() => findOnSafePath('tool', SEARCH(open)), CliGuardError)
    const noExec = join(sandbox, 'no-exec')
    mkdirSync(noExec)
    writeFileSync(join(noExec, 'tool'), '')
    chmodSync(join(noExec, 'tool'), 0o644)
    assert.throws(() => findOnSafePath('tool', SEARCH(noExec)), CliGuardError)
  })
})

describe('resolveAllowedExecutable (S8701/S8705: --gitleaks só da allowlist)', () => {
  let bin: string
  let gitleaks: string

  before(() => {
    bin = join(sandbox, 'gl-bin')
    gitleaks = fakeExecutable(bin, `gitleaks${EXE}`)
    fakeExecutable(bin, `evil${EXE}`)
  })

  it('aceita o nome simples (resolvido no PATH seguro) e o caminho absoluto do binário', () => {
    assert.equal(resolveAllowedExecutable('gitleaks', 'gitleaks', SEARCH(bin)), gitleaks)
    assert.equal(resolveAllowedExecutable(gitleaks, 'gitleaks', SEARCH('')), gitleaks)
  })

  for (const [value, label] of [
    ['evil', 'outro nome simples'],
    ['./gitleaks', 'caminho relativo'],
    ['gitleaks --config=/tmp/x', 'argumento embutido'],
    ['gitleaks; rm -rf /', 'metacaractere de shell'],
  ] as const) {
    it(`recusa ${JSON.stringify(value)} (${label})`, () => {
      assert.throws(() => resolveAllowedExecutable(value, 'gitleaks', SEARCH(bin)), CliGuardError)
    })
  }

  it('recusa caminho absoluto de outro binário ou inexistente', () => {
    assert.throws(
      () => resolveAllowedExecutable(join(bin, `evil${EXE}`), 'gitleaks', SEARCH(bin)),
      CliGuardError,
    )
    assert.throws(
      () => resolveAllowedExecutable(join(bin, 'nao-existe', 'gitleaks'), 'gitleaks', SEARCH(bin)),
      CliGuardError,
    )
  })

  it('recusa link chamado gitleaks que aponta para outro binário', {
    skip: IS_WINDOWS && 'symlink de arquivo exige privilégio no Windows',
  }, () => {
    const link = join(sandbox, 'gl-link')
    mkdirSync(link)
    symlinkSync(join(bin, 'evil'), join(link, 'gitleaks'))
    assert.throws(
      () => resolveAllowedExecutable(join(link, 'gitleaks'), 'gitleaks', SEARCH('')),
      CliGuardError,
    )
  })
})

describe('scripts da raiz, de ponta a ponta', () => {
  it('check-lockfile recusa um lockfile fora do repositório, mesmo válido', () => {
    const outside = join(sandbox, 'lock-outside')
    mkdirSync(outside)
    writeFileSync(join(outside, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeFileSync(join(outside, 'package.json'), '{}')
    const result = runScript('check-lockfile.ts', [join(outside, 'pnpm-lock.yaml')])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /fora do repositório/)
    const relative = runScript('check-lockfile.ts', ['../pnpm-lock.yaml'])
    assert.equal(relative.status, 1)
    assert.match(relative.stderr, /fora do repositório/)
  })

  it('pack-vercel-output recusa --out fora do repositório antes de escrever qualquer coisa', () => {
    const target = join(sandbox, 'escaped.tgz')
    const result = runScript('pack-vercel-output.ts', ['--out', target])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /fora do repositório/)
    assert.throws(() => readFileSync(target))
  })

  it('pack-vercel-output recusa --gitleaks fora da allowlist', () => {
    const result = runScript('pack-vercel-output.ts', [
      '--out',
      'dist/never.tgz',
      '--gitleaks',
      './evil',
    ])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--gitleaks/)
  })
})
