/**
 * Política do site estático (export do Next em `apps/web/out`) servido na mesma origem da API
 * (ADR 0029). Fonte única para os dois lugares que servem o export:
 *
 * - a Vercel, pelas rotas do `config.json` que `scripts/build-vercel-output.ts` gera (a CDN serve o
 *   estático, sem invocar a Function);
 * - o Plano B (Render), pelo plugin `static-site.ts`, quando `WEB_STATIC_DIR` está definida.
 *
 * Só constantes e funções puras, sem import: o script de build (Node com type stripping) importa
 * este arquivo direto.
 */

/** Locales do export; o primeiro é o padrão (o mesmo `LOCALES` de `@teko/shared/i18n`). */
export const STATIC_LOCALES = ['pt-BR', 'en'] as const

/**
 * Primeiro idioma do `Accept-Language` é inglês (`en`, `en-US`...). Igual ao `_redirects` que a
 * Netlify usava (`/ /en/ 302 Language=en`, senão `/pt-BR/`).
 */
export const ACCEPT_LANGUAGE_EN = '^\\s*en(?:-[A-Za-z0-9]+)*\\s*(?:[;,]|$)'

/**
 * Headers de todas as respostas estáticas (a API define os próprios, com CSP `default-src 'none'`).
 * A CSP não está aqui: ela depende do HTML (hashes dos `<script>` e `<style>` inline) e vem por
 * documento do manifesto que o pós-build do web grava (`HEADERS_MANIFEST_FILE`).
 */
export const STATIC_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'accelerometer=(), autoplay=(), browsing-topics=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(), gyroscope=(), hid=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(self), screen-wake-lock=(), serial=(), usb=(), xr-spatial-tracking=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const

/**
 * Manifesto de headers por documento, na raiz do export (`apps/web/out/.teko-headers.json`), gravado
 * pelo `apps/web/scripts/postbuild.ts`. Nunca é servido: a Vercel não o copia para o `static/`, o
 * `@fastify/static` ignora dotfiles e o Caddy o esconde.
 */
export const HEADERS_MANIFEST_FILE = '.teko-headers.json'

/** Os únicos headers que o manifesto pode definir (ele não injeta header arbitrário). */
const DOCUMENT_HEADER_NAMES = [
  'Content-Security-Policy',
  'Content-Security-Policy-Report-Only',
] as const

/** Headers de cada HTML do export, pelo caminho relativo do arquivo (`en/index.html`, `404.html`). */
export type DocumentHeaders = Readonly<Record<string, Readonly<Record<string, string>>>>

/** Caminho de arquivo do export sem `..`, sem barra inicial e terminado em `.html`. */
const DOCUMENT_FILE = /^(?:[A-Za-z0-9_$.-]+\/)*[A-Za-z0-9_$.-]+\.html$/
/** Valor de header sem caractere de controle, aspas nem crase (o Caddyfile o escreve entre aspas). */
const HEADER_VALUE = /^[\x20-\x21\x23-\x5f\x61-\x7e]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Valida o manifesto lido do export; qualquer desvio derruba quem o consome. */
export function parseHeadersManifest(value: unknown): DocumentHeaders {
  if (!isRecord(value) || value['version'] !== 1 || !isRecord(value['documents'])) {
    throw new Error(`${HEADERS_MANIFEST_FILE}: esperado { version: 1, documents: {...} }`)
  }
  const documents: Record<string, Record<string, string>> = {}
  for (const [file, headers] of Object.entries(value['documents'])) {
    if (!DOCUMENT_FILE.test(file) || file.split('/').includes('..')) {
      throw new Error(`${HEADERS_MANIFEST_FILE}: caminho de documento inválido: ${file}`)
    }
    if (!isRecord(headers) || typeof headers['Content-Security-Policy'] !== 'string') {
      throw new Error(`${HEADERS_MANIFEST_FILE}: ${file} sem Content-Security-Policy`)
    }
    const entry: Record<string, string> = {}
    for (const [name, headerValue] of Object.entries(headers)) {
      if (!(DOCUMENT_HEADER_NAMES as readonly string[]).includes(name)) {
        throw new Error(`${HEADERS_MANIFEST_FILE}: header não permitido em ${file}: ${name}`)
      }
      if (typeof headerValue !== 'string' || !HEADER_VALUE.test(headerValue)) {
        throw new Error(`${HEADERS_MANIFEST_FILE}: valor inválido de ${name} em ${file}`)
      }
      entry[name] = headerValue
    }
    documents[file] = entry
  }
  return documents
}

/**
 * Arquivo do export que atende o caminho com status 200 (`/en/` e `/en/index.html` →
 * `en/index.html`; `/404.html` → `404.html`), ou `null` se o caminho não é de documento. A raiz `/`
 * não serve documento: ela redireciona.
 */
export function documentFileFor(path: string): string | null {
  if (path.endsWith('/')) {
    return path === '/' ? null : `${path.slice(1)}index.html`
  }
  return path.endsWith('.html') ? path.slice(1) : null
}

/**
 * Regex (sensível à caixa) dos caminhos que servem o arquivo com status 200: `x/index.html` casa
 * `/x/` e `/x/index.html`; outro `.html` casa só o próprio caminho; o `index.html` da raiz, só
 * `/index.html` (a raiz redireciona).
 */
export function documentPathPattern(file: string): string {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (file === 'index.html') {
    return '^/index\\.html$'
  }
  if (file.endsWith('/index.html')) {
    return `^/${escaped.slice(0, -'index\\.html'.length)}(?:index\\.html)?$`
  }
  return `^/${escaped}$`
}

/** `/_next/static/*` tem hash no nome: cache de um ano. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** O redirect da raiz depende do `Accept-Language`, então nunca fica em cache compartilhado. */
export const ROOT_REDIRECT_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Accept-Language',
} as const

/** Destino do redirect da raiz para um `Accept-Language` (ou a falta dele). */
export function rootRedirectFor(acceptLanguage: string | undefined): string {
  const english =
    acceptLanguage !== undefined && new RegExp(ACCEPT_LANGUAGE_EN).test(acceptLanguage)
  return english ? '/en/' : `/${STATIC_LOCALES[0]}/`
}

/**
 * Página de 404 de um caminho inexistente: a do locale do caminho (sem distinção de caixa, como a
 * rota da Vercel), ou a da raiz.
 */
export function notFoundPageFor(path: string): string {
  const locale = STATIC_LOCALES.find(
    (candidate) =>
      path.toLowerCase() === `/${candidate.toLowerCase()}` ||
      path.toLowerCase().startsWith(`/${candidate.toLowerCase()}/`),
  )
  return locale === undefined ? '404.html' : `${locale}/404/index.html`
}
