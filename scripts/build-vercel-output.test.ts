import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  BuildOutputError,
  buildVercelOutput,
  FUNCTION_NAME,
  HANDLER,
  MAX_DURATION_S,
} from './build-vercel-output.ts'

/**
 * Forma do `.vercel/output` (Build Output API v3) que `build-vercel-output.ts` gera a partir do
 * bundle do tsdown e das dependências de produção (`pnpm test:scripts`). O deploy real fica no
 * workflow do spike F1 (b); aqui a montagem roda sobre um bundle e um `node_modules` de mentira.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')

let sandbox: string
let paths: { bundleDir: string; nodeModulesDir: string; outputDir: string }

function write(file: string, content = ''): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Todos os caminhos relativos da árvore, com `/`, e se algum é link simbólico. */
function tree(root: string, relative = ''): string[] {
  const entries: string[] = []
  for (const name of readdirSync(join(root, relative))) {
    const path = relative === '' ? name : `${relative}/${name}`
    const stat = lstatSync(join(root, path))
    assert.equal(stat.isSymbolicLink(), false, `link simbólico no output: ${path}`)
    entries.push(path)
    if (stat.isDirectory()) {
      entries.push(...tree(root, path))
    }
  }
  return entries.sort()
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'teko-vercel-output-'))
  paths = {
    bundleDir: join(sandbox, 'apps', 'api', 'dist'),
    nodeModulesDir: join(sandbox, 'deploy', 'node_modules'),
    outputDir: join(sandbox, '.vercel', 'output'),
  }
  write(join(paths.bundleDir, HANDLER), 'export {}\n')
  write(join(paths.bundleDir, `${HANDLER}.map`), '{}')
  const nm = paths.nodeModulesDir
  write(join(nm, 'fastify', 'package.json'), '{"name":"fastify"}')
  write(join(nm, 'fastify', 'fastify.js'))
  write(join(nm, 'fast-json-stringify', 'node_modules', 'ajv', 'package.json'), '{}')
  write(join(nm, 'fast-json-stringify', 'node_modules', '.bin', 'tool'))
  write(join(nm, '.bin', 'pino'))
  write(join(nm, '.pnpm', 'lock.yaml'))
  write(join(nm, '.modules.yaml'))
  write(join(nm, '.pnpm-workspace-state-v1.json'), '{}')
  write(join(nm, '@teko', 'shared', 'src', 'index.ts'))
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('buildVercelOutput', () => {
  it('gera config.json v3 com uma rota catch-all para a Function, depois do filesystem', () => {
    buildVercelOutput(paths)
    assert.deepEqual(readJson(join(paths.outputDir, 'config.json')), {
      version: 3,
      routes: [
        { handle: 'filesystem' },
        {
          src: '/(.*)',
          dest: '/',
          transforms: [{ type: 'request.path', op: 'set', args: '/$1' }],
        },
      ],
    })
  })

  it('gera uma única Function index.func com Node 24, launcher Nodejs e streaming', () => {
    const { functionDir } = buildVercelOutput(paths)
    assert.equal(FUNCTION_NAME, 'index')
    assert.deepEqual(readdirSync(join(paths.outputDir, 'functions')), ['index.func'])
    assert.equal(functionDir, join(paths.outputDir, 'functions', 'index.func'))
    assert.deepEqual(readJson(join(functionDir, '.vc-config.json')), {
      runtime: 'nodejs24.x',
      handler: 'server.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
      supportsResponseStreaming: true,
      maxDuration: MAX_DURATION_S,
    })
  })

  it('leva o bundle e só as dependências de produção, sem .bin, metadados do pnpm nem @teko', () => {
    buildVercelOutput(paths)
    assert.deepEqual(tree(paths.outputDir), [
      'config.json',
      'functions',
      'functions/index.func',
      'functions/index.func/.vc-config.json',
      'functions/index.func/node_modules',
      'functions/index.func/node_modules/fast-json-stringify',
      'functions/index.func/node_modules/fast-json-stringify/node_modules',
      'functions/index.func/node_modules/fast-json-stringify/node_modules/ajv',
      'functions/index.func/node_modules/fast-json-stringify/node_modules/ajv/package.json',
      'functions/index.func/node_modules/fastify',
      'functions/index.func/node_modules/fastify/fastify.js',
      'functions/index.func/node_modules/fastify/package.json',
      'functions/index.func/server.mjs',
      'functions/index.func/server.mjs.map',
    ])
  })

  it('recria o output do zero, sem sobras de um build anterior', () => {
    write(join(paths.outputDir, 'functions', 'old.func', '.vc-config.json'), '{}')
    write(join(paths.outputDir, 'static', 'index.html'))
    buildVercelOutput(paths)
    assert.deepEqual(readdirSync(paths.outputDir).sort(), ['config.json', 'functions'])
    assert.deepEqual(readdirSync(join(paths.outputDir, 'functions')), ['index.func'])
  })

  it('falha sem o bundle do tsdown', () => {
    rmSync(join(paths.bundleDir, HANDLER))
    assert.throws(() => buildVercelOutput(paths), BuildOutputError)
  })

  it('falha sem as dependências de produção', () => {
    rmSync(join(paths.nodeModulesDir, 'fastify'), { recursive: true })
    assert.throws(() => buildVercelOutput(paths), BuildOutputError)
  })

  it('recusa link simbólico nas dependências (linker isolado em vez de hoisted)', (t) => {
    try {
      symlinkSync(
        join(paths.nodeModulesDir, 'fastify'),
        join(paths.nodeModulesDir, 'pino'),
        'junction',
      )
    } catch {
      t.skip('sem permissão para criar link simbólico')
      return
    }
    assert.throws(() => buildVercelOutput(paths), /link simbólico em node_modules\/pino/)
  })
})

describe('maxDuration da Function', () => {
  for (const env of ['staging', 'production']) {
    it(`é igual a FUNCTION_MAX_DURATION_S de infra/vercel/env.${env}.json`, () => {
      const parsed = readJson(join(REPO_ROOT, 'infra', 'vercel', `env.${env}.json`))
      const value: unknown = Reflect.get(
        Reflect.get(Reflect.get(Object(parsed), 'config'), 'FUNCTION_MAX_DURATION_S'),
        'value',
      )
      assert.equal(value, String(MAX_DURATION_S))
    })
  }
})

describe('node scripts/build-vercel-output.ts', () => {
  it('não aceita argumento algum (código 2, nada escrito)', () => {
    const config = join(REPO_ROOT, '.vercel', 'output', 'config.json')
    const before = existsSync(config) ? statSync(config).mtimeMs : undefined
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'scripts', 'build-vercel-output.ts'), '--out', sandbox],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 2)
    assert.match(result.stderr, /uso: node scripts\/build-vercel-output\.ts/)
    assert.equal(existsSync(config) ? statSync(config).mtimeMs : undefined, before)
  })
})
