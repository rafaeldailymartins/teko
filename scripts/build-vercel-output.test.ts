import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  HEADERS_MANIFEST_FILE,
  parseHeadersManifest,
  STATIC_HEADERS,
} from '../apps/api/src/adapters/in/http/static-site/policy.ts'
import {
  BuildOutputError,
  buildIdentityFromEnv,
  buildVercelOutput,
  bundleClosure,
  FUNCTION_NAME,
  HANDLER,
  MAX_DURATION_S,
  outputConfig,
  REQUIRED_STATIC_FILES,
} from './build-vercel-output.ts'

/**
 * Forma do `.vercel/output` (Build Output API v3) que `build-vercel-output.ts` gera a partir do
 * export do Next, do bundle do tsdown e das dependências de produção (`pnpm test:scripts`). A
 * montagem roda sobre um export, um bundle e um `node_modules` de mentira; as rotas passam por um
 * simulador do roteamento da Vercel (abaixo) com os casos que importam, e, se `apps/web/out` existir
 * (depois do `pnpm --filter @teko/web build`), o mesmo simulador confere o export real.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')

let sandbox: string
let paths: { bundleDir: string; nodeModulesDir: string; staticDir: string; outputDir: string }

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

/** CSP de mentira de um documento, como o pós-build do web grava no manifesto. */
function cspOf(file: string): string {
  return `default-src 'self'; script-src 'self' 'sha256-${file}'`
}

function documentHeaders(file: string): Record<string, string> {
  return {
    'Content-Security-Policy': cspOf(file),
    'Content-Security-Policy-Report-Only': "require-trusted-types-for 'script'",
  }
}

function writeManifest(dir: string, files: readonly string[]): void {
  const documents = Object.fromEntries(files.map((file) => [file, documentHeaders(file)]))
  write(join(dir, HEADERS_MANIFEST_FILE), JSON.stringify({ version: 1, documents }))
}

/**
 * Export de mentira com a forma do `next build` (`output: 'export'`, `trailingSlash: true`) e o
 * manifesto de headers do pós-build do web.
 */
function writeStaticExport(dir: string): void {
  for (const file of REQUIRED_STATIC_FILES) {
    write(join(dir, file), `<!doctype html><title>${file}</title>`)
  }
  write(join(dir, 'pt-BR', 'index.txt'), 'rsc')
  write(join(dir, '_next', 'static', 'chunks', 'app.js'), 'js\n//# sourceMappingURL=app.js.map')
  // Source maps do `productionBrowserSourceMaps` (ADR 0037): ficam no export, nunca no static/.
  write(join(dir, '_next', 'static', 'chunks', 'app.js.map'), '{"version":3}')
  write(join(dir, '_next', 'static', 'css', 'app.CSS.MAP'), '{"version":3}')
  writeManifest(dir, REQUIRED_STATIC_FILES)
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'teko-vercel-output-'))
  paths = {
    bundleDir: join(sandbox, 'apps', 'api', 'dist'),
    nodeModulesDir: join(sandbox, 'deploy', 'node_modules'),
    staticDir: join(sandbox, 'apps', 'web', 'out'),
    outputDir: join(sandbox, '.vercel', 'output'),
  }
  // Forma do bundle do tsdown: chunks compartilhados entre `server.mjs` e `cli.mjs`, importados
  // estática e dinamicamente, e um chunk que só a CLI usa.
  const bundle = paths.bundleDir
  write(
    join(bundle, HANDLER),
    'import { a } from "./composition-root-AbC1.mjs";\nconst env = await import("./env-Xy2.mjs");\n',
  )
  write(join(bundle, `${HANDLER}.map`), '{}')
  write(join(bundle, 'composition-root-AbC1.mjs'), "import './shared-Q9.mjs'\nexport const a = 1\n")
  write(join(bundle, 'composition-root-AbC1.mjs.map'), '{}')
  write(join(bundle, 'env-Xy2.mjs'), 'export const env = {}\n')
  write(join(bundle, 'shared-Q9.mjs'), 'export {}\n')
  write(
    join(bundle, 'cli.mjs'),
    'import "./composition-root-AbC1.mjs";\nimport "./cli-only-Z.mjs";\n',
  )
  write(join(bundle, 'cli.mjs.map'), '{}')
  write(join(bundle, 'cli-only-Z.mjs'), 'export {}\n')
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
  writeStaticExport(paths.staticDir)
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

// --- Simulador do roteamento da Vercel (Build Output API v3) ------------------------------------
//
// Cobre o que o `config.json` usa: `src` (regex sem distinção de caixa, salvo `caseSensitive`),
// `has` de host e de header (`value` como texto exato ou `{ re }`), `headers`, `status` com
// `Location`, `continue`, `dest` com `$1`, `handle: filesystem` (arquivo exato, ou `index.html` do
// diretório) e as rotas depois dele, avaliadas só quando o filesystem não acha o caminho.

interface Request {
  readonly path: string
  readonly host?: string
  readonly headers?: Readonly<Record<string, string>>
}

type Outcome =
  | { kind: 'redirect'; status: number; location: string; headers: Record<string, string> }
  | { kind: 'function'; path: string; headers: Record<string, string> }
  | { kind: 'static'; status: number; file: string; headers: Record<string, string> }

interface RouteLike {
  readonly src?: string
  readonly dest?: string
  readonly status?: number
  readonly headers?: Readonly<Record<string, string>>
  readonly continue?: boolean
  readonly caseSensitive?: boolean
  readonly handle?: string
  readonly has?: readonly {
    readonly type: string
    readonly key?: string
    readonly value?: string | { readonly re: string }
  }[]
  readonly transforms?: readonly { readonly args: string }[]
}

function hasMatches(route: RouteLike, request: Request): boolean {
  return (route.has ?? []).every((condition) => {
    const actual =
      condition.type === 'host'
        ? (request.host ?? 'tekoia.vercel.app')
        : request.headers?.[condition.key ?? '']
    if (actual === undefined) {
      return false
    }
    const expected = condition.value
    return typeof expected === 'string'
      ? actual === expected
      : new RegExp(expected?.re ?? '').test(actual)
  })
}

function substitute(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? '')
}

/** O arquivo existe com essa caixa exata (o filesystem do Windows e do macOS ignora a caixa). */
function existsWithCase(root: string, file: string): boolean {
  let dir = root
  for (const segment of file.split('/')) {
    if (!existsSync(dir) || !readdirSync(dir).includes(segment)) {
      return false
    }
    dir = join(dir, segment)
  }
  return statSync(dir).isFile()
}

function fileFor(staticDir: string, path: string): string | null {
  const relative = decodeURIComponent(path).replace(/^\//, '')
  const candidates = path.endsWith('/') ? [`${relative}index.html`] : [relative]
  return candidates.find((file) => file !== '' && existsWithCase(staticDir, file)) ?? null
}

/**
 * Junta os headers de mais uma rota. Um header que já veio de outra rota com outro valor derruba o
 * teste: as rotas não podem depender de como a Vercel combina headers repetidos.
 */
function mergeHeaders(
  headers: Record<string, string>,
  extra: Readonly<Record<string, string>>,
  path: string,
): void {
  for (const [name, value] of Object.entries(extra)) {
    const previous = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
    if (previous !== undefined && headers[previous] !== value) {
      throw new Error(`${path}: o header ${name} vem de duas rotas com valores diferentes`)
    }
    headers[name] = value
  }
}

/** Rotas do `config.json` gravado ao lado do `static/`. */
function routesNextTo(staticDir: string): readonly RouteLike[] {
  return Reflect.get(Object(readJson(join(dirname(staticDir), 'config.json'))), 'routes')
}

function route(staticDir: string, request: Request): Outcome {
  const routes = routesNextTo(staticDir)
  const headers: Record<string, string> = {}
  const filesystemAt = routes.findIndex((r) => r.handle === 'filesystem')
  for (const [index, current] of routes.entries()) {
    if (index === filesystemAt) {
      const file = fileFor(staticDir, request.path)
      if (file !== null) {
        return { kind: 'static', status: 200, file, headers }
      }
      continue
    }
    if (current.src === undefined) {
      continue
    }
    const match = new RegExp(current.src, current.caseSensitive === true ? '' : 'i').exec(
      request.path,
    )
    if (match === null || !hasMatches(current, request)) {
      continue
    }
    mergeHeaders(headers, current.headers ?? {}, request.path)
    if (current.continue === true) {
      continue
    }
    const location = headers['Location']
    if (location !== undefined && current.status !== undefined) {
      return {
        kind: 'redirect',
        status: current.status,
        location: substitute(location, match),
        headers,
      }
    }
    if (current.transforms !== undefined) {
      const args = current.transforms[0]?.args ?? ''
      return { kind: 'function', path: substitute(args, match), headers }
    }
    if (current.dest !== undefined) {
      return {
        kind: 'static',
        status: current.status ?? 200,
        file: substitute(current.dest, match).replace(/^\//, ''),
        headers,
      }
    }
  }
  throw new Error(`nenhuma rota para ${request.path}`)
}

// --- Montagem -----------------------------------------------------------------------------------

describe('buildVercelOutput', () => {
  it('gera config.json v3 com as rotas da API antes do filesystem e os 404 depois', () => {
    buildVercelOutput(paths)
    const config = readJson(join(paths.outputDir, 'config.json'))
    const documents = parseHeadersManifest(readJson(join(paths.staticDir, HEADERS_MANIFEST_FILE)))
    const expected = outputConfig(documents)
    assert.deepEqual(config, JSON.parse(JSON.stringify(expected)))
    const routes = expected.routes.map((r) => ('handle' in r ? `handle:${r.handle}` : r.src))
    const api = routes.indexOf('^/(api(?:/.*)?|healthz)$')
    const filesystem = routes.indexOf('handle:filesystem')
    assert.ok(api >= 0 && filesystem > api, 'a API vem antes do filesystem')
    assert.equal(routes.at(-1), '^/.*$')
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
      maxDuration: 120,
      supportsCancellation: true,
    })
    assert.equal(MAX_DURATION_S, 120)
  })

  it('grava GIT_SHA e APP_VERSION no environment da Function quando há identidade (F7)', () => {
    const gitSha = 'a'.repeat(40)
    const { functionDir } = buildVercelOutput(paths, { gitSha, version: '0.1.0-rc.1' })
    const config = readJson(join(functionDir, '.vc-config.json'))
    assert.deepEqual(Reflect.get(Object(config), 'environment'), {
      GIT_SHA: gitSha,
      APP_VERSION: '0.1.0-rc.1',
    })
    assert.equal(Reflect.get(Object(config), 'runtime'), 'nodejs24.x')
  })

  it('leva o export para static/, o handler com os chunks que ele importa e só as dependências de produção', () => {
    const result = buildVercelOutput(paths)
    assert.deepEqual(tree(paths.outputDir), [
      'config.json',
      'functions',
      'functions/index.func',
      'functions/index.func/.vc-config.json',
      'functions/index.func/composition-root-AbC1.mjs',
      'functions/index.func/composition-root-AbC1.mjs.map',
      'functions/index.func/env-Xy2.mjs',
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
      'functions/index.func/shared-Q9.mjs',
      'static',
      'static/404.html',
      'static/_next',
      'static/_next/static',
      'static/_next/static/chunks',
      'static/_next/static/chunks/app.js',
      'static/_next/static/css',
      'static/en',
      'static/en/404',
      'static/en/404/index.html',
      'static/en/index.html',
      'static/index.html',
      'static/pt-BR',
      'static/pt-BR/404',
      'static/pt-BR/404/index.html',
      'static/pt-BR/index.html',
      'static/pt-BR/index.txt',
    ])
    assert.equal(result.staticFiles, 8)
  })

  it('os source maps do export não vão para o static/ (nunca são servidos)', () => {
    buildVercelOutput(paths)
    const served = tree(join(paths.outputDir, 'static'))
    assert.deepEqual(
      served.filter((file) => /\.map$/i.test(file)),
      [],
    )
    assert.ok(existsSync(join(paths.staticDir, '_next', 'static', 'chunks', 'app.js.map')))
    const outcome = route(join(paths.outputDir, 'static'), {
      path: '/_next/static/chunks/app.js.map',
    })
    assert.deepEqual(outcome.kind === 'static' ? [outcome.status, outcome.file] : outcome.kind, [
      404,
      '404.html',
    ])
  })

  it('recria o output do zero, sem sobras de um build anterior', () => {
    write(join(paths.outputDir, 'functions', 'old.func', '.vc-config.json'), '{}')
    write(join(paths.outputDir, 'static', 'velho.html'))
    buildVercelOutput(paths)
    assert.deepEqual(readdirSync(paths.outputDir).sort(), ['config.json', 'functions', 'static'])
    assert.deepEqual(readdirSync(join(paths.outputDir, 'functions')), ['index.func'])
    assert.equal(existsSync(join(paths.outputDir, 'static', 'velho.html')), false)
  })

  it('falha sem o bundle do tsdown', () => {
    rmSync(join(paths.bundleDir, HANDLER))
    assert.throws(() => buildVercelOutput(paths), BuildOutputError)
  })

  it('falha se o handler importa um chunk que não existe (ERR_MODULE_NOT_FOUND no boot)', () => {
    rmSync(join(paths.bundleDir, 'shared-Q9.mjs'))
    assert.throws(() => buildVercelOutput(paths), /shared-Q9\.mjs é importado pelo bundle/)
  })

  it('o fechamento de imports do bundle real (apps/api/dist) é o que a Function leva', (t) => {
    const dist = join(REPO_ROOT, 'apps', 'api', 'dist')
    if (!existsSync(join(dist, HANDLER))) {
      t.skip(
        'apps/api/dist ausente: rode `pnpm --filter @teko/api build` para conferir o bundle real',
      )
      return
    }
    const files = bundleClosure(dist, HANDLER)
    assert.ok(files.includes(HANDLER))
    assert.ok(!files.includes('cli.mjs'))
    for (const file of files) {
      assert.ok(existsSync(join(dist, file)), file)
    }
  })

  it('falha sem as dependências de produção', () => {
    rmSync(join(paths.nodeModulesDir, 'fastify'), { recursive: true })
    assert.throws(() => buildVercelOutput(paths), BuildOutputError)
  })

  it('falha sem o export estático (ou sem as páginas de 404 por locale)', () => {
    rmSync(join(paths.staticDir, 'en', '404'), { recursive: true })
    assert.throws(() => buildVercelOutput(paths), /en\/404\/index\.html/)
  })

  it('recusa arquivos de configuração da Netlify no export', () => {
    write(join(paths.staticDir, '_redirects'), '/ /pt-BR/ 302')
    assert.throws(() => buildVercelOutput(paths), /arquivo proibido no export estático: _redirects/)
  })

  it('falha sem o manifesto de headers do pós-build do web', () => {
    rmSync(join(paths.staticDir, HEADERS_MANIFEST_FILE))
    assert.throws(() => buildVercelOutput(paths), /\.teko-headers\.json/)
  })

  it('falha se um HTML do export não tem CSP no manifesto, ou se o manifesto cita HTML inexistente', () => {
    write(join(paths.staticDir, 'en', 'novo', 'index.html'), '<!doctype html>')
    assert.throws(() => buildVercelOutput(paths), /sem CSP: en\/novo\/index\.html/)
    rmSync(join(paths.staticDir, 'en', 'novo'), { recursive: true })
    writeManifest(paths.staticDir, [...REQUIRED_STATIC_FILES, 'velho/index.html'])
    assert.throws(() => buildVercelOutput(paths), /inexistentes: velho\/index\.html/)
  })

  it('recusa manifesto com header fora da lista', () => {
    const documents = Object.fromEntries(
      REQUIRED_STATIC_FILES.map((file) => [file, { ...documentHeaders(file), 'Set-Cookie': 'a' }]),
    )
    write(join(paths.staticDir, HEADERS_MANIFEST_FILE), JSON.stringify({ version: 1, documents }))
    assert.throws(() => buildVercelOutput(paths), /header não permitido/)
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

// --- Rotas ---------------------------------------------------------------------------------------

describe('rotas do config.json', () => {
  const staticDir = (): string => join(paths.outputDir, 'static')

  it('/api/* e /healthz vão para a Function, com o caminho original e sem os headers do estático', () => {
    buildVercelOutput(paths)
    for (const path of ['/api/v1/questions', '/api/healthz', '/healthz', '/api']) {
      const outcome = route(staticDir(), { path })
      assert.equal(outcome.kind, 'function', path)
      assert.equal(outcome.kind === 'function' && outcome.path, path)
      assert.deepEqual(outcome.headers, {})
    }
  })

  it('a raiz redireciona pelo Accept-Language (302, sem cache compartilhado)', () => {
    buildVercelOutput(paths)
    const cases = [
      [undefined, '/pt-BR/'],
      ['pt-BR,pt;q=0.9,en;q=0.8', '/pt-BR/'],
      ['en-US,en;q=0.9', '/en/'],
      ['en', '/en/'],
      ['es-ES,en;q=0.5', '/pt-BR/'],
    ] as const
    for (const [language, location] of cases) {
      const outcome = route(staticDir(), {
        path: '/',
        ...(language === undefined ? {} : { headers: { 'accept-language': language } }),
      })
      assert.equal(outcome.kind, 'redirect', String(language))
      assert.equal(outcome.kind === 'redirect' && outcome.status, 302)
      assert.equal(outcome.kind === 'redirect' && outcome.location, location, String(language))
      assert.equal(outcome.headers['Vary'], 'Accept-Language')
    }
  })

  it('serve as páginas do export com os headers de segurança e a CSP do documento', () => {
    buildVercelOutput(paths)
    for (const [path, file, document] of [
      ['/pt-BR/', 'pt-BR/index.html', 'pt-BR/index.html'],
      ['/pt-BR/index.html', 'pt-BR/index.html', 'pt-BR/index.html'],
      ['/en/', 'en/index.html', 'en/index.html'],
      ['/en/404/', 'en/404/index.html', 'en/404/index.html'],
      ['/404.html', '404.html', '404.html'],
      ['/index.html', 'index.html', 'index.html'],
      ['/pt-BR/index.txt', 'pt-BR/index.txt', null],
    ] as const) {
      const outcome = route(staticDir(), { path })
      assert.deepEqual(
        { kind: outcome.kind, file: outcome.kind === 'static' ? outcome.file : null },
        { kind: 'static', file },
      )
      assert.equal(outcome.kind === 'static' && outcome.status, 200)
      assert.deepEqual(outcome.headers, {
        ...STATIC_HEADERS,
        ...(document === null ? {} : documentHeaders(document)),
      })
    }
  })

  it('a CSP de um documento não vaza para outra caixa nem para o redirect da raiz', () => {
    buildVercelOutput(paths)
    const upper = route(staticDir(), { path: '/EN/' })
    assert.equal(upper.kind === 'static' && upper.status, 404)
    assert.equal(upper.headers['Content-Security-Policy'], cspOf('en/404/index.html'))
    const root = route(staticDir(), { path: '/' })
    assert.equal(root.headers['Content-Security-Policy'], undefined)
  })

  it('/_next/static/* é imutável', () => {
    buildVercelOutput(paths)
    const outcome = route(staticDir(), { path: '/_next/static/chunks/app.js' })
    assert.equal(outcome.kind, 'static')
    assert.equal(outcome.headers['Cache-Control'], 'public, max-age=31536000, immutable')
  })

  it('trailingSlash: caminho sem barra final ganha a barra (308); arquivo com extensão, não', () => {
    buildVercelOutput(paths)
    const outcome = route(staticDir(), { path: '/pt-BR' })
    assert.equal(outcome.kind === 'redirect' && outcome.status, 308)
    assert.equal(outcome.kind === 'redirect' && outcome.location, '/pt-BR/')
    assert.equal(
      outcome.headers['Strict-Transport-Security'],
      STATIC_HEADERS['Strict-Transport-Security'],
    )
    const withExtension = route(staticDir(), { path: '/404.html' })
    assert.equal(withExtension.kind, 'static')
  })

  it('/pt-br/... (minúsculo) redireciona para /pt-BR/...', () => {
    buildVercelOutput(paths)
    const outcome = route(staticDir(), { path: '/pt-br/' })
    assert.equal(outcome.kind === 'redirect' && outcome.location, '/pt-BR/')
  })

  it('404 por locale e 404 da raiz para o resto, cada um com a CSP da sua página', () => {
    buildVercelOutput(paths)
    for (const [path, file] of [
      ['/en/xyz/', 'en/404/index.html'],
      ['/pt-BR/nada/', 'pt-BR/404/index.html'],
      ['/outra/', '404.html'],
      ['/favicon.ico', '404.html'],
      ['/_next/static/chunks/sumiu.js', '404.html'],
    ] as const) {
      const outcome = route(staticDir(), { path })
      assert.equal(outcome.kind, 'static', path)
      assert.equal(outcome.kind === 'static' && outcome.status, 404, path)
      assert.equal(outcome.kind === 'static' && outcome.file, file, path)
      assert.equal(outcome.headers['Content-Security-Policy'], cspOf(file), path)
      assert.equal(outcome.headers['X-Content-Type-Options'], 'nosniff', path)
    }
  })

  it('domínios antigos respondem 308 para o canônico do mesmo projeto, inclusive na API', () => {
    buildVercelOutput(paths)
    for (const [host, path, location] of [
      ['teko-api.vercel.app', '/healthz', 'https://tekoia.vercel.app/healthz'],
      ['teko-api.vercel.app', '/pt-BR/', 'https://tekoia.vercel.app/pt-BR/'],
      ['teko-api-staging.vercel.app', '/api/v1/x', 'https://tekoia-staging.vercel.app/api/v1/x'],
    ] as const) {
      const outcome = route(staticDir(), { path, host })
      assert.equal(outcome.kind === 'redirect' && outcome.status, 308, host)
      assert.equal(outcome.kind === 'redirect' && outcome.location, location, host)
    }
    assert.equal(
      route(staticDir(), { path: '/healthz', host: 'tekoia.vercel.app' }).kind,
      'function',
    )
  })

  it('o export real do web (apps/web/out) é servido pelas mesmas rotas', (t) => {
    const realOut = join(REPO_ROOT, 'apps', 'web', 'out')
    if (!existsSync(join(realOut, 'index.html'))) {
      t.skip(
        'apps/web/out ausente: rode `pnpm --filter @teko/web build` para conferir o export real',
      )
      return
    }
    buildVercelOutput({ ...paths, staticDir: realOut })
    const served = route(staticDir(), { path: '/pt-BR/' })
    assert.equal(served.kind === 'static' && served.file, 'pt-BR/index.html')
    const enNotFound = route(staticDir(), { path: '/en/xyz/' })
    assert.equal(enNotFound.kind === 'static' && enNotFound.status, 404)
    assert.equal(existsSync(join(staticDir(), HEADERS_MANIFEST_FILE)), false)
    // Conferência independente do htmlparser2: o hash de cada `<script>` inline sem atributos,
    // tirado do HTML por regex, está na CSP que a rota entrega.
    for (const [path, file] of [
      ['/pt-BR/', 'pt-BR/index.html'],
      ['/en/xyz/', 'en/404/index.html'],
    ] as const) {
      const csp = route(staticDir(), { path }).headers['Content-Security-Policy'] ?? ''
      assert.match(csp, /^default-src 'self'; script-src 'self' 'sha256-/)
      assert.doesNotMatch(csp, /strict-dynamic|script-src[^;]*'unsafe-inline'/)
      const html = readFileSync(join(realOut, file), 'utf8')
      const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1] ?? '')
      assert.ok(inline.length > 0, `${file} tem scripts inline (tema e payload do Next)`)
      for (const content of inline) {
        const hash = createHash('sha256').update(content, 'utf8').digest('base64')
        assert.ok(csp.includes(`'sha256-${hash}'`), `${path}: hash de um script inline fora da CSP`)
      }
    }
    const asset = readdirSync(join(realOut, '_next', 'static', 'chunks')).find((name) =>
      name.endsWith('.js'),
    )
    assert.ok(asset !== undefined, 'o export tem chunks em _next/static/chunks')
    const chunk = route(staticDir(), { path: `/_next/static/chunks/${asset}` })
    assert.equal(chunk.kind, 'static')
    assert.equal(chunk.headers['Cache-Control'], 'public, max-age=31536000, immutable')
  })
})

describe('buildIdentityFromEnv', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567'

  it('sem SHA (build local): sem identidade', () => {
    assert.equal(buildIdentityFromEnv({}), undefined)
    assert.equal(buildIdentityFromEnv({ GIT_SHA: '  ' }), undefined)
  })

  it('GIT_SHA tem prioridade sobre GITHUB_SHA, com a versão obrigatória', () => {
    assert.deepEqual(
      buildIdentityFromEnv({ GIT_SHA: sha, GITHUB_SHA: 'f'.repeat(40), APP_VERSION: '0.1.0' }),
      { gitSha: sha, version: '0.1.0' },
    )
    assert.deepEqual(buildIdentityFromEnv({ GITHUB_SHA: sha, APP_VERSION: '0.0.0-0123456' }), {
      gitSha: sha,
      version: '0.0.0-0123456',
    })
  })

  it('recusa SHA curto ou maiúsculo, versão ausente, com v ou fora do SemVer', () => {
    for (const env of [
      { GIT_SHA: 'abc1234', APP_VERSION: '0.1.0' },
      { GIT_SHA: sha.toUpperCase(), APP_VERSION: '0.1.0' },
      { GIT_SHA: sha },
      { GIT_SHA: sha, APP_VERSION: 'v0.1.0' },
      { GIT_SHA: sha, APP_VERSION: '0.1' },
      { APP_VERSION: '0.1.0' },
    ]) {
      assert.throws(() => buildIdentityFromEnv(env), BuildOutputError, JSON.stringify(env))
    }
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
