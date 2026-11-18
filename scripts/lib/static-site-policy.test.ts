import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCALES } from '../../packages/shared/src/i18n/locales.ts'
import {
  documentPathPattern,
  HEADERS_MANIFEST_FILE,
  isSourceMapPath,
  notFoundPageFor,
  parseHeadersManifest,
  rootRedirectFor,
  STATIC_LOCALES,
} from './static-site-policy.ts'

/**
 * Política do site estático (`pnpm test:scripts`). O comportamento servido de verdade é conferido
 * pelo `apps/web/e2e/platform.spec.ts` contra a stack de CI; a forma das rotas da Vercel e dos
 * snippets do Caddy, por `build-vercel-output.test.ts` e `caddy-static-site.test.ts`.
 */
describe('política do site estático', () => {
  it('os locales são os do @teko/shared', () => {
    assert.deepEqual([...STATIC_LOCALES], [...LOCALES])
  })

  it('a raiz redireciona pelo Accept-Language', () => {
    for (const [language, location] of [
      [undefined, '/pt-BR/'],
      ['en-US,en;q=0.9', '/en/'],
      ['pt-BR,en;q=0.5', '/pt-BR/'],
    ] as const) {
      assert.equal(rootRedirectFor(language), location, String(language))
    }
  })

  it('404 com a página do locale do caminho, ou a da raiz', () => {
    for (const [path, page] of [
      ['/en/xyz/', 'en/404/index.html'],
      ['/pt-BR', 'pt-BR/404/index.html'],
      ['/pt-br/a/', 'pt-BR/404/index.html'],
      ['/english/', '404.html'],
      ['/x', '404.html'],
    ] as const) {
      assert.equal(notFoundPageFor(path), page, path)
    }
  })

  it('caminhos que servem cada documento', () => {
    for (const [file, matches, misses] of [
      ['en/index.html', ['/en/', '/en/index.html'], ['/EN/', '/en/x/', '/en']],
      ['index.html', ['/index.html'], ['/', '/xindex.html']],
      ['404.html', ['/404.html'], ['/404xhtml', '/en/404.html']],
      ['pt-BR/404/index.html', ['/pt-BR/404/'], ['/pt-br/404/', '/pt-BR/404x/']],
    ] as const) {
      const pattern = new RegExp(documentPathPattern(file))
      for (const path of matches) {
        assert.equal(pattern.test(path), true, path)
      }
      for (const path of misses) {
        assert.equal(pattern.test(path), false, path)
      }
    }
  })

  it('source maps em qualquer grafia', () => {
    assert.equal(isSourceMapPath('/_next/static/chunks/app.js.map'), true)
    assert.equal(isSourceMapPath('/_next/static/chunks/APP.JS.MAP'), true)
    assert.equal(isSourceMapPath('/_next/static/chunks/app.js'), false)
  })

  it('o manifesto só aceita a CSP, o report-only e o Reporting-Endpoints, com valores seguros', () => {
    const csp = { 'Content-Security-Policy': "default-src 'self'" }
    assert.deepEqual(parseHeadersManifest({ version: 1, documents: { 'en/index.html': csp } }), {
      'en/index.html': csp,
    })
    const reporting = {
      ...csp,
      'Reporting-Endpoints': 'posthog="https://eu.i.posthog.com/report/?token=phc_abc"',
    }
    assert.deepEqual(
      parseHeadersManifest({ version: 1, documents: { 'en/index.html': reporting } }),
      { 'en/index.html': reporting },
    )
    for (const documents of [
      { 'en/index.html': { ...csp, 'Reporting-Endpoints': 'posthog="http://x/"' } },
      { 'en/index.html': { ...csp, 'Reporting-Endpoints': 'posthog="https://x/"a"' } },
      { 'en/index.html': { ...csp, 'Reporting-Endpoints': 'posthog="https://x/`"' } },
      { 'en/index.html': { ...csp, 'Reporting-Endpoints': 'a="https://x/", b="https://y/"' } },
      { 'en/index.html': { ...csp, 'Set-Cookie': 'a=b' } },
      { 'en/index.html': { 'Content-Security-Policy': 'a\r\nX-Injected: 1' } },
      { 'en/index.html': { 'Content-Security-Policy': 'say "hi"' } },
      { '../x.html': csp },
      { 'en/index.txt': csp },
      { 'en/index.html': {} },
    ]) {
      assert.throws(() => parseHeadersManifest({ version: 1, documents }), {
        message: new RegExp(HEADERS_MANIFEST_FILE.replaceAll('.', '\\.')),
      })
    }
    assert.throws(() => parseHeadersManifest({ version: 2, documents: {} }), /version: 1/)
  })
})
