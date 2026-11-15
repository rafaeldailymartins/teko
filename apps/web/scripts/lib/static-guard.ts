import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HEADERS_MANIFEST_FILE } from './csp.ts'
import { listFiles } from './html.ts'

/**
 * Guard do export estático puro (`docs/architecture/frontend.md`, "Runtime"): o web não tem código
 * de servidor. Duas metades, as duas no `pnpm --filter @teko/web build` (pós-build) e a primeira
 * também no `test:unit`:
 *
 * - **código-fonte:** nada de route handler (`route.ts`), `'use server'`,
 *   `dynamic = 'force-dynamic'`, middleware/`proxy.ts` nem rotas de API do Pages Router;
 * - **build:** os manifestos do `.next` sem middleware, functions nem Server Actions, o export
 *   concluído e o `out/` só com tipos de arquivo estáticos.
 *
 * Cada função devolve a lista de violações (vazia quando está tudo certo).
 */

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/
const ROUTE_HANDLER = /(?:^|\/)route\.[cm]?[jt]sx?$/
const PLATFORM_ENTRY = /^(?:src\/)?(?:middleware|proxy)\.[cm]?[jt]s$/
const PAGES_API = /^(?:src\/)?pages\/api\//
/** Diretiva `'use server'` (de arquivo ou de função) no início de uma instrução. */
const USE_SERVER = /(?:^|[;{]\s*|\n\s*)(['"])use server\1/
const FORCE_DYNAMIC = /\bdynamic\s*=\s*(['"])force-dynamic\1/

/** Extensões que o export estático pode ter (HTML, payload RSC, JS, CSS, fontes e imagens). */
const STATIC_EXTENSIONS = new Set([
  'html',
  'txt',
  'js',
  'css',
  'map',
  'json',
  'webmanifest',
  'xml',
  'woff2',
  'woff',
  'ttf',
  'otf',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'ico',
])

function webFiles(webDir: string): string[] {
  const roots = ['src', 'app', 'pages'].filter((dir) => existsSync(join(webDir, dir)))
  const top = ['middleware', 'proxy']
    .flatMap((name) => ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'].map((ext) => `${name}.${ext}`))
    .filter((file) => existsSync(join(webDir, file)))
  return [
    ...top,
    ...roots.flatMap((dir) => listFiles(join(webDir, dir), '').map((f) => `${dir}/${f}`)),
  ]
}

/** Violações no código-fonte de `apps/web` (testes ficam de fora: eles citam o que é proibido). */
export function findServerOnlySources(webDir: string): string[] {
  const violations: string[] = []
  for (const file of webFiles(webDir)) {
    if (!SOURCE_FILE.test(file) || /\.test\.[jt]sx?$/.test(file)) {
      continue
    }
    if (ROUTE_HANDLER.test(file) && /^(?:src\/)?app\//.test(file)) {
      violations.push(`${file}: route handler (o export estático não tem servidor)`)
    }
    if (PLATFORM_ENTRY.test(file)) {
      violations.push(`${file}: middleware/proxy não roda no export estático`)
    }
    if (PAGES_API.test(file)) {
      violations.push(`${file}: rota de API do Pages Router (a API é o Fastify)`)
    }
    const source = readFileSync(join(webDir, file), 'utf8')
    if (USE_SERVER.test(source)) {
      violations.push(`${file}: 'use server' (Server Actions não existem no export estático)`)
    }
    if (FORCE_DYNAMIC.test(source)) {
      violations.push(`${file}: dynamic = 'force-dynamic' (toda rota é estática)`)
    }
  }
  return violations
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sizeOf(value: unknown): number {
  return value !== null && typeof value === 'object' ? Object.keys(value).length : 0
}

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? Reflect.get(value, key) : undefined
}

/** Violações no resultado do `next build` (`.next` e `out/`). */
export function findNonStaticOutput(webDir: string): string[] {
  const next = join(webDir, '.next')
  const out = join(webDir, 'out')
  const violations: string[] = []
  const exportDetail = join(next, 'export-detail.json')
  if (!existsSync(join(out, 'index.html')) || !existsSync(exportDetail)) {
    return ['out/index.html ou .next/export-detail.json ausente: o build não gerou export estático']
  }
  if (field(readJson(exportDetail), 'success') !== true) {
    violations.push('.next/export-detail.json: o export não terminou com sucesso')
  }
  const checks: [string, string[]][] = [
    ['server/middleware-manifest.json', ['middleware', 'functions']],
    ['server/functions-config-manifest.json', ['functions']],
    ['server/server-reference-manifest.json', ['node', 'edge']],
  ]
  for (const [manifest, keys] of checks) {
    const path = join(next, manifest)
    if (!existsSync(path)) {
      continue
    }
    const parsed = readJson(path)
    for (const key of keys) {
      if (sizeOf(field(parsed, key)) > 0) {
        violations.push(`.next/${manifest}: "${key}" não está vazio (código de servidor no build)`)
      }
    }
  }
  const routes = join(next, 'app-path-routes-manifest.json')
  if (existsSync(routes)) {
    for (const entry of Object.keys(Object(readJson(routes)))) {
      if (entry.endsWith('/route')) {
        violations.push(`.next/app-path-routes-manifest.json: route handler ${entry}`)
      }
    }
  }
  for (const file of listFiles(out)) {
    if (file === HEADERS_MANIFEST_FILE) {
      continue
    }
    const extension = /\.([^./]+)$/.exec(file)?.[1]?.toLowerCase()
    if (extension === undefined || !STATIC_EXTENSIONS.has(extension)) {
      violations.push(`out/${file}: tipo de arquivo fora do estático`)
    }
  }
  return violations
}
