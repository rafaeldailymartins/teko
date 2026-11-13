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
 * Headers das respostas estáticas (a API define os próprios, com CSP `default-src 'none'`). O CSP
 * daqui só traz diretivas que não dependem do HTML; o CSP completo, com os hashes dos `<script>` e
 * `<style>` inline, entra por caminho na F5 (plano, "Segurança no navegador").
 */
export const STATIC_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
} as const

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

/** Página de 404 de um caminho inexistente: a do locale do caminho, ou a da raiz. */
export function notFoundPageFor(path: string): string {
  const locale = STATIC_LOCALES.find(
    (candidate) =>
      path.toLowerCase() === `/${candidate.toLowerCase()}` ||
      path.toLowerCase().startsWith(`/${candidate.toLowerCase()}/`),
  )
  return locale === undefined ? '404.html' : `${locale}/404/index.html`
}
