import { createHash } from 'node:crypto'
import { compareCodeUnits, type ParsedDocument } from './html.ts'

/**
 * CSP por documento do export estático (`docs/architecture/frontend.md`, "Segurança no navegador").
 * O export não tem servidor para gerar nonce, então cada `<script>` e `<style>` inline entra pelo
 * sha256 do conteúdo, e cada HTML ganha a própria CSP. O resultado vai para o manifesto
 * `out/.teko-headers.json`, que os três lugares que servem o export consomem: a Vercel (rotas do
 * `config.json`, `scripts/build-vercel-output.ts`), o Plano B (`apps/api`, `static-site.ts`) e o
 * Caddy da stack de CI (`scripts/caddy-static-site.ts`).
 */

/** Nome do manifesto de headers por documento, na raiz do export (nunca servido). */
export const HEADERS_MANIFEST_FILE = '.teko-headers.json'

/**
 * Teto da CSP de um documento, em bytes. Header grande demais é cortado ou recusado por proxies e
 * CDNs (a Vercel limita o conjunto de headers da resposta); cada hash custa cerca de 55 bytes.
 */
export const MAX_CSP_BYTES = 6 * 1024

/** Trusted Types em observação até a v0.1.0 (enforce depois de 14 dias sem violação no staging). */
export const TRUSTED_TYPES_REPORT_ONLY = "require-trusted-types-for 'script'"

/** Origens de `connect-src` além da própria: o PostHog (EU), chamado direto do navegador. */
const CONNECT_ORIGINS = ['https://eu.i.posthog.com'] as const

export class CspTooLargeError extends Error {}

/** `'sha256-<base64>'` do conteúdo, como o navegador calcula (UTF-8). */
export function sha256Source(content: string): string {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`
}

function hashSources(contents: readonly string[]): string[] {
  return [...new Set(contents.map(sha256Source))].sort(compareCodeUnits)
}

/**
 * A CSP do documento. Sem `'strict-dynamic'`, que anularia o `'self'` dos chunks do Next; sem
 * `'unsafe-inline'` em scripts nem em elementos de estilo; `style-src-attr 'unsafe-inline'` é a
 * concessão consciente para o Motion e os painéis redimensionáveis. O `report-to` fica de fora até a
 * F6 decidir o destino dos relatórios (PostHog Error Tracking ou Sentry).
 */
export function contentSecurityPolicy(document: ParsedDocument): string {
  return [
    "default-src 'self'",
    ["script-src 'self'", ...hashSources(document.inlineScripts)].join(' '),
    ["style-src-elem 'self'", ...hashSources(document.inlineStyles)].join(' '),
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "worker-src 'self'",
    ["connect-src 'self'", ...CONNECT_ORIGINS].join(' '),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/** Headers que dependem do HTML, por arquivo do export (`en/index.html`, `404.html`...). */
export interface HeadersManifest {
  readonly version: 1
  readonly documents: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Monta o manifesto; falha se a CSP de algum documento passar de `MAX_CSP_BYTES`. */
export function buildHeadersManifest(
  documents: ReadonlyMap<string, ParsedDocument>,
): HeadersManifest {
  const entries: [string, Record<string, string>][] = []
  const sorted = [...documents].sort(([a], [b]) => (a < b ? -1 : 1))
  for (const [file, document] of sorted) {
    const csp = contentSecurityPolicy(document)
    const bytes = Buffer.byteLength(csp, 'utf8')
    if (bytes > MAX_CSP_BYTES) {
      throw new CspTooLargeError(
        `a CSP de ${file} tem ${bytes} bytes (teto ${MAX_CSP_BYTES}): scripts ou estilos inline demais`,
      )
    }
    entries.push([
      file,
      {
        'Content-Security-Policy': csp,
        'Content-Security-Policy-Report-Only': TRUSTED_TYPES_REPORT_ONLY,
      },
    ])
  }
  return { version: 1, documents: Object.fromEntries(entries) }
}
