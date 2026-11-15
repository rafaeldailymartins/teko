import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { LOCALES } from '@teko/shared/i18n'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTempDir } from '../../../../../test/setup/temp-dir.ts'
import { buildApp } from '../../../../build-app.ts'
import { createContainer, createHttpOptions } from '../../../../composition-root.ts'
import { parseEnv } from '../../../../config/env.ts'
import {
  documentFileFor,
  documentPathPattern,
  HEADERS_MANIFEST_FILE,
  IMMUTABLE_CACHE_CONTROL,
  notFoundPageFor,
  parseHeadersManifest,
  rootRedirectFor,
  STATIC_HEADERS,
  STATIC_LOCALES,
} from './policy.ts'

/**
 * Plano B (Render): o Fastify serve o export do web na mesma origem da API, com a mesma política
 * das rotas da Vercel (`policy.ts`). O export aqui é de mentira, com a forma do `next build` e o
 * manifesto de headers do pós-build do web.
 */

let root: string
let app: FastifyInstance

/** CSP de mentira por documento, como o pós-build do web grava no manifesto. */
const cspOf = (file: string): string => `default-src 'self'; script-src 'self' 'sha256-${file}'`
const DOCUMENTS = [
  'index.html',
  '404.html',
  ...STATIC_LOCALES.flatMap((locale) => [`${locale}/index.html`, `${locale}/404/index.html`]),
]
const ENV = { APP_ENV: 'ci', WEB_ORIGIN: 'https://tekoia.vercel.app', LOG_LEVEL: 'silent' } as const

function write(relative: string, content: string): void {
  const file = join(root, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'teko-static-site-'))
  write('index.html', '<p>entrada</p>')
  write('404.html', '<p>404 raiz</p>')
  for (const locale of STATIC_LOCALES) {
    write(`${locale}/index.html`, `<p>home ${locale}</p>`)
    write(`${locale}/404/index.html`, `<p>404 ${locale}</p>`)
  }
  write('_next/static/chunks/app.js', 'console.log(1)')
  const documents = DOCUMENTS.map((file) => [
    file,
    {
      'Content-Security-Policy': cspOf(file),
      'Content-Security-Policy-Report-Only': "require-trusted-types-for 'script'",
    },
  ])
  write(
    HEADERS_MANIFEST_FILE,
    JSON.stringify({ version: 1, documents: Object.fromEntries(documents) }),
  )
  const env = parseEnv({ ...ENV, WEB_STATIC_DIR: root })
  // Sem o limite de atraso do event loop: com a suíte em paralelo, o primeiro request lento (carga do
  // @fastify/send) viraria 503 do under-pressure, que não é o que este teste mede.
  app = await buildApp({
    container: createContainer(env),
    http: { ...createHttpOptions(env), eventLoopDelayGuard: false },
  })
})

afterAll(async () => {
  await app.close()
  removeTempDir(root)
})

describe('política do site estático', () => {
  it('os locales são os do @teko/shared', () => {
    expect([...STATIC_LOCALES]).toEqual([...LOCALES])
  })

  it.each([
    [undefined, '/pt-BR/'],
    ['en-US,en;q=0.9', '/en/'],
    ['pt-BR,en;q=0.5', '/pt-BR/'],
  ])('raiz com Accept-Language %j → %s', (language, location) => {
    expect(rootRedirectFor(language)).toBe(location)
  })

  it.each([
    ['/en/xyz/', 'en/404/index.html'],
    ['/pt-BR', 'pt-BR/404/index.html'],
    ['/pt-br/a/', 'pt-BR/404/index.html'],
    ['/english/', '404.html'],
    ['/x', '404.html'],
  ])('404 de %s → %s', (path, page) => {
    expect(notFoundPageFor(path)).toBe(page)
  })

  it.each([
    ['/en/', 'en/index.html'],
    ['/en/index.html', 'en/index.html'],
    ['/404.html', '404.html'],
    ['/', null],
    ['/_next/static/chunks/app.js', null],
    ['/en', null],
  ])('documento de %s → %s', (path, file) => {
    expect(documentFileFor(path)).toBe(file)
  })

  it.each([
    ['en/index.html', ['/en/', '/en/index.html'], ['/EN/', '/en/x/', '/en']],
    ['index.html', ['/index.html'], ['/', '/xindex.html']],
    ['404.html', ['/404.html'], ['/404xhtml', '/en/404.html']],
    ['pt-BR/404/index.html', ['/pt-BR/404/'], ['/pt-br/404/', '/pt-BR/404x/']],
  ])('caminhos que servem %s', (file, matches, misses) => {
    const pattern = new RegExp(documentPathPattern(file))
    for (const path of matches) {
      expect(pattern.test(path), path).toBe(true)
    }
    for (const path of misses) {
      expect(pattern.test(path), path).toBe(false)
    }
  })

  it('o manifesto só aceita a CSP e o report-only, com valores seguros', () => {
    const csp = { 'Content-Security-Policy': "default-src 'self'" }
    expect(parseHeadersManifest({ version: 1, documents: { 'en/index.html': csp } })).toEqual({
      'en/index.html': csp,
    })
    for (const documents of [
      { 'en/index.html': { ...csp, 'Set-Cookie': 'a=b' } },
      { 'en/index.html': { 'Content-Security-Policy': 'a\r\nX-Injected: 1' } },
      { 'en/index.html': { 'Content-Security-Policy': 'say "hi"' } },
      { '../x.html': csp },
      { 'en/index.txt': csp },
      { 'en/index.html': {} },
    ]) {
      expect(() => parseHeadersManifest({ version: 1, documents })).toThrow(HEADERS_MANIFEST_FILE)
    }
    expect(() => parseHeadersManifest({ version: 2, documents: {} })).toThrow(/version: 1/)
  })
})

describe('registerStaticSite (WEB_STATIC_DIR)', () => {
  it('a raiz redireciona pelo Accept-Language, sem cache compartilhado', async () => {
    const res = await app.inject({ url: '/', headers: { 'accept-language': 'en' } })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/en/')
    expect(res.headers.vary).toBe('Accept-Language')
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('serve as páginas com os headers do estático e a CSP do documento, não a da API', async () => {
    for (const url of ['/pt-BR/', '/pt-BR/index.html']) {
      const res = await app.inject({ url })
      expect(res.statusCode).toBe(200)
      expect(res.body).toBe('<p>home pt-BR</p>')
      expect(res.headers['content-type']).toMatch(/^text\/html/)
      expect(res.headers['content-security-policy']).toBe(cspOf('pt-BR/index.html'))
      expect(res.headers['content-security-policy-report-only']).toBe(
        "require-trusted-types-for 'script'",
      )
      expect(res.headers['x-frame-options']).toBe('DENY')
      expect(res.headers['strict-transport-security']).toBe(
        STATIC_HEADERS['Strict-Transport-Security'],
      )
    }
  })

  it('/_next/static/* é imutável e fica sem CSP, como na Vercel', async () => {
    const res = await app.inject({ url: '/_next/static/chunks/app.js' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL)
    expect(res.headers['content-security-policy']).toBeUndefined()
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('o manifesto nunca é servido', async () => {
    const res = await app.inject({ url: `/${HEADERS_MANIFEST_FILE}` })
    expect(res.statusCode).toBe(404)
    expect(res.body).toBe('<p>404 raiz</p>')
  })

  it('diretório sem barra final redireciona para a barra; /pt-br vai para /pt-BR', async () => {
    const dir = await app.inject({ url: '/en' })
    expect([301, 308]).toContain(dir.statusCode)
    expect(dir.headers.location).toBe('/en/')
    const lower = await app.inject({ url: '/pt-br/a/b/' })
    expect(lower.statusCode).toBe(308)
    expect(lower.headers.location).toBe('/pt-BR/a/b/')
    expect((await app.inject({ url: '/pt-br' })).headers.location).toBe('/pt-BR/')
  })

  it('caminho inexistente: 404 com a página do locale, ou a da raiz', async () => {
    const inLocale = await app.inject({ url: '/en/nada/' })
    expect(inLocale.statusCode).toBe(404)
    expect(inLocale.body).toBe('<p>404 en</p>')
    expect(inLocale.headers['content-security-policy']).toBe(cspOf('en/404/index.html'))
    const outside = await app.inject({ url: '/nada.txt' })
    expect(outside.statusCode).toBe(404)
    expect(outside.body).toBe('<p>404 raiz</p>')
    expect(outside.headers['content-security-policy']).toBe(cspOf('404.html'))
  })

  it('a API continua com problem+json e os headers dela', async () => {
    const res = await app.inject({ url: '/api/v1/nada' })
    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect(res.headers['content-security-policy']).toContain("default-src 'none'")
    const post = await app.inject({ method: 'POST', url: '/qualquer' })
    expect(post.headers['content-type']).toMatch(/^application\/problem\+json/)
    expect((await app.inject({ url: '/healthz' })).json()).toMatchObject({ status: 'ok' })
  })

  it('não sai da raiz do export', async () => {
    const res = await app.inject({ url: '/..%2f..%2fpackage.json' })
    expect([400, 403, 404]).toContain(res.statusCode)
    expect(res.body).not.toContain('"name"')
  })

  it('sem o manifesto de headers, o servidor não sobe', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'teko-static-site-bare-'))
    try {
      const env = parseEnv({ ...ENV, WEB_STATIC_DIR: bare })
      await expect(
        buildApp({
          container: createContainer(env),
          http: { ...createHttpOptions(env), eventLoopDelayGuard: false },
        }),
      ).rejects.toThrow(/\.teko-headers\.json não existe/)
    } finally {
      removeTempDir(bare)
    }
  })

  it('WEB_STATIC_DIR é proibida na Vercel', () => {
    expect(() =>
      parseEnv({
        APP_ENV: 'ci',
        WEB_ORIGIN: 'https://tekoia.vercel.app',
        RUNTIME_TARGET: 'vercel',
        FUNCTION_MAX_DURATION_S: '120',
        WEB_STATIC_DIR: root,
      }),
    ).toThrow(/WEB_STATIC_DIR: não se aplica com RUNTIME_TARGET=vercel/)
  })
})
