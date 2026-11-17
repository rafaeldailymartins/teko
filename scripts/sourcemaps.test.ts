import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import {
  binaryPath,
  filesMissingChunkId,
  injectArgs,
  offlineInjectEnv,
  POSTHOG_EU_APP_HOST,
  scriptFiles,
  UNREACHABLE_PROXY,
  uploadArgs,
  uploadEnv,
} from './sourcemaps.ts'

/**
 * Source maps do PostHog (`pnpm test:scripts`). O CLI de verdade roda na stack de CI (`infra/ci/up.sh`
 * injeta o export do web, e o e2e confere que nada mudou de comportamento); aqui ficam o ambiente
 * offline do `inject`, os argumentos e a conferência do chunk id.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'sourcemaps.ts')

describe('offlineInjectEnv', () => {
  it('deixa de fora o CI e o git, bloqueia a rede e usa uma credencial de mentira', () => {
    const env = offlineInjectEnv({
      PATH: '/usr/bin',
      HOME: '/home/runner',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_REPOSITORY: 'o/r',
      GITHUB_ACTIONS: 'true',
      CI: 'true',
      POSTHOG_CLI_API_KEY: 'phx_de_verdade',
      POSTHOG_CLI_HOST: 'https://us.posthog.com',
      HTTPS_PROXY: 'http://proxy.corp:3128',
    })
    assert.deepEqual(Object.keys(env).sort(), [
      'ALL_PROXY',
      'HOME',
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'NO_PROXY',
      'PATH',
      'POSTHOG_CLI_API_KEY',
      'POSTHOG_CLI_PROJECT_ID',
      'http_proxy',
      'https_proxy',
      'no_proxy',
    ])
    assert.equal(env['HTTPS_PROXY'], UNREACHABLE_PROXY)
    assert.equal(env['https_proxy'], UNREACHABLE_PROXY)
    assert.equal(env['NO_PROXY'], '')
    assert.notEqual(env['POSTHOG_CLI_API_KEY'], 'phx_de_verdade')
    assert.match(env['POSTHOG_CLI_API_KEY'] ?? '', /^phx_/)
  })
})

describe('uploadEnv', () => {
  it('exige a chave pessoal e o projeto, e não repassa o resto do CI', () => {
    const env = uploadEnv({
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'ghs_x',
      POSTHOG_CLI_API_KEY: 'phx_abc',
      POSTHOG_CLI_PROJECT_ID: '12345',
    })
    assert.deepEqual(env, {
      PATH: '/usr/bin',
      POSTHOG_CLI_API_KEY: 'phx_abc',
      POSTHOG_CLI_PROJECT_ID: '12345',
    })
    assert.throws(() => uploadEnv({ POSTHOG_CLI_PROJECT_ID: '1' }), /POSTHOG_CLI_API_KEY/)
    assert.throws(
      () => uploadEnv({ POSTHOG_CLI_API_KEY: 'phc_publica', POSTHOG_CLI_PROJECT_ID: '1' }),
      /POSTHOG_CLI_API_KEY/,
    )
    assert.throws(
      () => uploadEnv({ POSTHOG_CLI_API_KEY: 'phx_abc', POSTHOG_CLI_PROJECT_ID: 'x' }),
      /POSTHOG_CLI_PROJECT_ID/,
    )
  })
})

describe('argumentos do CLI', () => {
  it('inject só com o diretório (sem release: offline)', () => {
    assert.deepEqual(injectArgs('/r/apps/api/dist'), [
      'sourcemap',
      'inject',
      '--directory',
      '/r/apps/api/dist',
    ])
  })

  it('upload na UE com o release teko@<versão>', () => {
    assert.deepEqual(uploadArgs('/r/apps/web/out/_next/static', '0.1.0'), [
      '--host',
      POSTHOG_EU_APP_HOST,
      'sourcemap',
      'upload',
      '--directory',
      '/r/apps/web/out/_next/static',
      '--release-name',
      'teko',
      '--release-version',
      '0.1.0',
    ])
    assert.equal(uploadArgs('/d', 'abc1234').at(-1), 'abc1234')
    for (const bad of ['v0.1.0', 'latest', '0.1', 'ABC1234', '1.0.0; rm -rf /']) {
      assert.throws(() => uploadArgs('/d', bad), /release-version/)
    }
  })

  it('binário do tools/posthog-cli por plataforma', () => {
    assert.ok(binaryPath('win32').endsWith(join('tools', 'posthog-cli', 'bin', 'posthog-cli.exe')))
    assert.ok(binaryPath('linux').endsWith(join('tools', 'posthog-cli', 'bin', 'posthog-cli')))
  })
})

describe('filesMissingChunkId', () => {
  it('aponta só os scripts com .map e sem o chunk id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teko-sourcemaps-test-'))
    try {
      mkdirSync(join(dir, 'chunks'))
      const injected = join(dir, 'chunks', 'a.js')
      const pending = join(dir, 'chunks', 'b.mjs')
      writeFileSync(
        injected,
        '!function(){}();x()\n//# sourceMappingURL=a.js.map\n\n//# chunkId=534800ed-6da1-5693-b1da-5cd890cd3e31\n',
      )
      writeFileSync(`${injected}.map`, '{}')
      writeFileSync(pending, 'y()\n//# sourceMappingURL=b.mjs.map\n')
      writeFileSync(`${pending}.map`, '{}')
      writeFileSync(join(dir, 'sem-map.js'), 'z()')
      writeFileSync(join(dir, 'estilo.css'), 'a{}')
      assert.deepEqual(scriptFiles(dir), [injected, pending, join(dir, 'sem-map.js')])
      assert.deepEqual(filesMissingChunkId(dir), [pending])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('linha de comando', () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: {} })
  }

  it('uso errado termina com 2', () => {
    for (const args of [
      [],
      ['deploy'],
      ['inject', '--only', 'tudo'],
      ['inject', 'x'],
      ['upload'],
    ]) {
      const result = run(...args)
      assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`)
      assert.match(result.stderr, /uso: node scripts\/sourcemaps\.ts/)
    }
  })

  it('upload sem a chave pessoal termina com 2 antes de chamar o CLI', () => {
    const result = run('upload', '--release-version', '0.1.0', '--only', 'api')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /POSTHOG_CLI_API_KEY/)
  })
})
