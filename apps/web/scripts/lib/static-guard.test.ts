import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findNonStaticOutput, findServerOnlySources } from './static-guard.ts'

const WEB_DIR = fileURLToPath(new URL('../..', import.meta.url))

let dir: string

function write(relative: string, content = ''): void {
  mkdirSync(dirname(join(dir, relative)), { recursive: true })
  writeFileSync(join(dir, relative), content)
}

/** `.next` e `out/` com a forma de um `next build` com `output: 'export'` limpo. */
function writeCleanBuild(): void {
  write('.next/export-detail.json', '{"version":1,"success":true}')
  write('.next/server/middleware-manifest.json', '{"middleware":{},"functions":{}}')
  write('.next/server/functions-config-manifest.json', '{"functions":{}}')
  write('.next/server/server-reference-manifest.json', '{"node":{},"edge":{}}')
  write('.next/app-path-routes-manifest.json', '{"/[locale]/page":"/[locale]"}')
  write('out/index.html', '<!doctype html>')
  write('out/en/index.txt', 'rsc')
  write('out/_next/static/chunks/a.js', 'js')
  write('out/_next/static/media/f.woff2', '')
  write('out/.teko-headers.json', '{}')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'teko-web-guard-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('findServerOnlySources', () => {
  it('o código do apps/web é só estático', () => {
    expect(findServerOnlySources(WEB_DIR)).toEqual([])
  })

  it('aponta route handler, Server Action, force-dynamic, middleware/proxy e API do Pages Router', () => {
    write('src/app/[locale]/page.tsx', "export const dynamic = 'force-static'\n")
    write('src/app/api/hello/route.ts', 'export function GET() {}\n')
    write('src/components/form.tsx', "'use client'\nasync function save() {\n  'use server'\n}\n")
    write('src/lib/actions.ts', '"use server"\nexport async function x() {}\n')
    write('src/app/live/page.tsx', 'export const dynamic = "force-dynamic"\n')
    write('proxy.ts', 'export function proxy() {}\n')
    write('src/middleware.ts', 'export function middleware() {}\n')
    write('pages/api/x.ts', 'export default function handler() {}\n')
    write('src/lib/ok.test.ts', "it('use server', () => {}) // 'use server' em teste não conta\n")
    const violations = findServerOnlySources(dir)
    expect(violations).toEqual([
      'proxy.ts: middleware/proxy não roda no export estático',
      'src/app/api/hello/route.ts: route handler (o export estático não tem servidor)',
      "src/app/live/page.tsx: dynamic = 'force-dynamic' (toda rota é estática)",
      "src/components/form.tsx: 'use server' (Server Actions não existem no export estático)",
      "src/lib/actions.ts: 'use server' (Server Actions não existem no export estático)",
      'src/middleware.ts: middleware/proxy não roda no export estático',
      'pages/api/x.ts: rota de API do Pages Router (a API é o Fastify)',
    ])
  })
})

describe('findNonStaticOutput', () => {
  it('aceita um export limpo (o manifesto de headers inclusive)', () => {
    writeCleanBuild()
    expect(findNonStaticOutput(dir)).toEqual([])
  })

  it('sem out/ nem export-detail, o build não foi estático', () => {
    expect(findNonStaticOutput(dir)).toEqual([
      'out/index.html ou .next/export-detail.json ausente: o build não gerou export estático',
    ])
  })

  it('aponta middleware, functions, Server Actions, route handler e arquivo não estático', () => {
    writeCleanBuild()
    write('.next/export-detail.json', '{"success":false}')
    write('.next/server/middleware-manifest.json', '{"middleware":{"/":{}},"functions":{}}')
    write('.next/server/functions-config-manifest.json', '{"functions":{"/api":{}}}')
    write('.next/server/server-reference-manifest.json', '{"node":{"abc":{}},"edge":{}}')
    write('.next/app-path-routes-manifest.json', '{"/api/x/route":"/api/x"}')
    write('out/api/handler.php', '<?php')
    write('out/LICENSE', '')
    expect(findNonStaticOutput(dir)).toEqual([
      '.next/export-detail.json: o export não terminou com sucesso',
      '.next/server/middleware-manifest.json: "middleware" não está vazio (código de servidor no build)',
      '.next/server/functions-config-manifest.json: "functions" não está vazio (código de servidor no build)',
      '.next/server/server-reference-manifest.json: "node" não está vazio (código de servidor no build)',
      '.next/app-path-routes-manifest.json: route handler /api/x/route',
      'out/LICENSE: tipo de arquivo fora do estático',
      'out/api/handler.php: tipo de arquivo fora do estático',
    ])
  })

  it('o build real (quando existe) é só estático', (context) => {
    if (!existsSync(join(WEB_DIR, 'out', 'index.html'))) {
      context.skip()
    }
    expect(findNonStaticOutput(WEB_DIR)).toEqual([])
  })
})
