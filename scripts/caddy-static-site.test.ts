import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { caddySnippets } from './caddy-static-site.ts'
import {
  ACCEPT_LANGUAGE_EN,
  IMMUTABLE_CACHE_CONTROL,
  parseHeadersManifest,
  STATIC_HEADERS,
} from './lib/static-site-policy.ts'

/**
 * Snippets do Caddy da stack de CI (`pnpm test:scripts`). O comportamento real (redirects, 404 por
 * locale, CSP sem violação no navegador) é conferido pelo `apps/web/e2e/platform.spec.ts` contra a
 * stack; aqui fica a forma do que é gerado a partir do `static-site-policy.ts` e do manifesto.
 */

const REPO_ROOT = resolve(import.meta.dirname, '..')

const documents = parseHeadersManifest({
  version: 1,
  documents: Object.fromEntries(
    ['index.html', '404.html', 'en/index.html', 'en/404/index.html', 'pt-BR/404/index.html'].map(
      (file) => [file, { 'Content-Security-Policy': `default-src 'self'; x-${file}` }],
    ),
  ),
})

describe('caddySnippets', () => {
  const snippets = caddySnippets(documents)

  it('define os dois snippets que o Caddyfile importa', () => {
    const caddyfile = readFileSync(join(REPO_ROOT, 'infra', 'ci', 'Caddyfile'), 'utf8')
    assert.match(caddyfile, /^import \/etc\/caddy\/static-site\.caddy$/m)
    for (const name of ['teko_static', 'teko_not_found']) {
      assert.match(snippets, new RegExp(`^\\(${name}\\) \\{$`, 'm'))
      assert.match(caddyfile, new RegExp(`^\\t+import ${name}$`, 'm'))
    }
    const compose = readFileSync(join(REPO_ROOT, 'infra', 'ci', 'compose.yaml'), 'utf8')
    assert.match(compose, /- \.\/\.static-site\.caddy:\/etc\/caddy\/static-site\.caddy:ro/)
  })

  it('aplica os headers do static-site-policy.ts, a CSP por documento e o cache imutável', () => {
    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      assert.ok(snippets.includes(`${name} "${value}"`), name)
    }
    assert.ok(
      snippets.includes(`header /_next/static/* Cache-Control "${IMMUTABLE_CACHE_CONTROL}"`),
    )
    assert.ok(snippets.includes('path_regexp `(?i)^/en/(?:index\\.html)?$`'))
    assert.ok(snippets.includes('path_regexp `(?i)^/index\\.html$`'))
    assert.ok(snippets.includes(`Content-Security-Policy "default-src 'self'; x-en/index.html"`))
  })

  it('redireciona a raiz pelo Accept-Language e cuida da caixa e da barra final', () => {
    assert.ok(snippets.includes(`header_regexp Accept-Language \`${ACCEPT_LANGUAGE_EN}\``))
    assert.ok(snippets.includes('redir @root_en /en/ 302'))
    assert.ok(snippets.includes('redir / /pt-BR/ 302'))
    assert.ok(snippets.includes('redir @lowercase_pt_br /pt-BR{re.lowercase.1} 308'))
    assert.ok(snippets.includes('redir @no_slash /{re.no_slash.1}/ 308'))
    assert.ok(snippets.includes('hide .teko-headers.json'))
  })

  it('os source maps respondem 404 antes do file_server (ADR 0037)', () => {
    const route = snippets.slice(
      snippets.indexOf('(teko_static)'),
      snippets.indexOf('(teko_not_found)'),
    )
    const matcher = route.indexOf('@source_map path_regexp source_map `(?i)\\.map$`')
    const error = route.indexOf('error @source_map 404')
    assert.ok(matcher > 0 && error > matcher, 'matcher e error no route')
    assert.ok(error < route.indexOf('file_server {'), 'antes do file_server')
  })

  it('o Reporting-Endpoints (valor com aspas) vai entre crases', () => {
    const value = 'posthog="https://eu.i.posthog.com/report/?token=phc_abc"'
    const withReporting = caddySnippets(
      Object.fromEntries(
        Object.entries(documents).map(([file, headers]) => [
          file,
          { ...headers, 'Reporting-Endpoints': value },
        ]),
      ),
    )
    assert.ok(withReporting.includes(`Reporting-Endpoints \`${value}\``))
    assert.throws(
      () =>
        caddySnippets({
          ...documents,
          'en/index.html': { 'Content-Security-Policy': 'a\nb' },
        }),
      /quebra de linha/,
    )
  })

  it('404 do locale com a CSP da página dele, e o 404.html para o resto', () => {
    const notFound = snippets.slice(snippets.indexOf('(teko_not_found)'))
    assert.ok(notFound.includes('rewrite * /en/404/index.html'))
    assert.ok(notFound.includes('rewrite * /pt-BR/404/index.html'))
    assert.ok(notFound.includes('rewrite * /404.html'))
    assert.ok(notFound.includes(`"default-src 'self'; x-en/404/index.html"`))
    assert.ok(notFound.includes(`"default-src 'self'; x-404.html"`))
  })

  it('falha se o manifesto não tem a página de 404 de um locale', () => {
    const { 'pt-BR/404/index.html': _, ...partial } = documents
    assert.throws(() => caddySnippets(partial), /não tem os headers de pt-BR\/404\/index\.html/)
  })

  it('o manifesto real do export (quando existe) gera snippets', (t) => {
    const manifest = join(REPO_ROOT, 'apps', 'web', 'out', '.teko-headers.json')
    if (!existsSync(manifest)) {
      t.skip('apps/web/out ausente: rode `pnpm --filter @teko/web build`')
      return
    }
    const real = caddySnippets(parseHeadersManifest(JSON.parse(readFileSync(manifest, 'utf8'))))
    assert.match(real, /script-src 'self' 'sha256-/)
  })
})

describe('node scripts/caddy-static-site.ts', () => {
  it('não aceita argumento algum (código 2)', () => {
    const result = spawnSync(
      process.execPath,
      [join(REPO_ROOT, 'scripts', 'caddy-static-site.ts'), '--out', 'x'],
      { encoding: 'utf8' },
    )
    assert.equal(result.status, 2)
    assert.match(result.stderr, /uso: node scripts\/caddy-static-site\.ts/)
  })
})
