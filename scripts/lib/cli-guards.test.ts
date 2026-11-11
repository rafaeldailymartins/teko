import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { CliGuardError, compareCodeUnits, findOnSafePath, resolveInsideRoot } from './cli-guards.ts'

/**
 * Guardas dos scripts da raiz (`scripts/*.ts`). Roda com o test runner nativo do Node 24
 * (`pnpm test:scripts` = `node --test`), sem pacote nem dependência: os scripts ficam fora dos três
 * pacotes do workspace, e o `turbo boundaries` proíbe que um pacote importe arquivos de fora dele.
 * Cobre os helpers de `cli-guards.ts` e, de ponta a ponta, que os scripts não aceitam caminho
 * nem executável na linha de comando: `check-lockfile` não aceita argumento algum e
 * `pack-vercel-output` aceita só `--env production|staging`.
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

describe('scripts da raiz de ponta a ponta (S8707/S8701/S8705: sem caminho nem executável no argv)', () => {
  it('check-lockfile sem argumentos verifica os lockfiles fixos e passa', () => {
    const result = runScript('check-lockfile.ts', [])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /check-lockfile: pnpm-lock\.yaml ok/)
    assert.match(result.stderr, /check-lockfile: tools\/vercel-cli\/pnpm-lock\.yaml ok/)
    assert.match(result.stderr, /check-lockfile: tools\/netlify-cli\/pnpm-lock\.yaml ok/)
  })

  for (const args of [
    ['pnpm-lock.yaml'],
    ['tools/vercel-cli/pnpm-lock.yaml'],
    ['../pnpm-lock.yaml'],
    ['--help'],
  ]) {
    it(`check-lockfile recusa qualquer argumento com código 2: ${JSON.stringify(args)}`, () => {
      const result = runScript('check-lockfile.ts', args)
      assert.equal(result.status, 2)
      assert.match(result.stderr, /não aceita argumentos/)
    })
  }

  for (const [args, message] of [
    [[], /--env é obrigatório/],
    [['--env', 'nope'], /--env "nope" desconhecido/],
    [['--env', '../production'], /desconhecido/],
    [['--env', 'production', 'extra'], /extra/],
    [['--env', 'production', '--out', 'dist/x.tgz'], /--out/],
    [['--env', 'production', '--gitleaks', 'gitleaks'], /--gitleaks/],
    [['--env', 'production', '--vercel-dir', '.vercel'], /--vercel-dir/],
  ] as const) {
    it(`pack-vercel-output recusa ${JSON.stringify(args)} com código 2, antes de ler o build`, () => {
      const result = runScript('pack-vercel-output.ts', args)
      assert.equal(result.status, 2, result.stderr)
      assert.match(result.stderr, message)
      assert.match(
        result.stderr,
        /uso: node scripts\/pack-vercel-output\.ts --env production\|staging/,
      )
    })
  }
})
