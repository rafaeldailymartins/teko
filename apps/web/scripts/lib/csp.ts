import { createHash } from 'node:crypto'
import { POSTHOG_API_HOST, POSTHOG_ORIGINS } from '../../src/lib/analytics/posthog-hosts.ts'
import { compareCodeUnits, type ParsedDocument } from './html.ts'

/**
 * CSP por documento do export estático (`docs/architecture/frontend.md`, "Segurança no navegador").
 * O export não tem servidor para gerar nonce, então cada `<script>` e `<style>` inline entra pelo
 * sha256 do conteúdo, e cada HTML ganha a própria CSP. O resultado vai para o manifesto
 * `out/.teko-headers.json`, que os dois lugares que servem o export consomem: a Vercel (rotas do
 * `config.json`, `scripts/build-vercel-output.ts`) e o Caddy da stack de CI
 * (`scripts/caddy-static-site.ts`).
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

/**
 * Origens de `connect-src` além da própria: o PostHog (UE), chamado direto do navegador depois do
 * consentimento (ingestão e a configuração remota do projeto, lida do host de assets) e pelo
 * cliente de erros. Os relatórios de CSP não precisam dela: quem os manda é o navegador.
 */
const CONNECT_ORIGINS = POSTHOG_ORIGINS

/** Grupo do `report-to` e nome do endpoint no `Reporting-Endpoints`. */
export const REPORT_GROUP = 'posthog'

/** Chave pública do projeto PostHog (`phc_…`), a única coisa variável no endpoint. */
const PROJECT_KEY = /^phc_[A-Za-z0-9_]{1,128}$/

export class CspTooLargeError extends Error {}
export class CspConfigError extends Error {}

/** Opções do build: com a chave dos erros, as violações vão ao PostHog (ADR 0037). */
export interface CspOptions {
  readonly reportKey?: string | undefined
}

/**
 * Endpoint de relatórios do PostHog na UE (`/report/?token=<chave>`, com a barra final que a
 * documentação exige). Recebe as violações das duas políticas: a CSP e o Trusted Types em
 * report-only (uma violação de `require-trusted-types-for` é um relatório de CSP como outro).
 */
export function reportingEndpoint(key: string): string {
  if (!PROJECT_KEY.test(key)) {
    throw new CspConfigError('NEXT_PUBLIC_POSTHOG_ERRORS_KEY não é uma chave de projeto (phc_…)')
  }
  return `${POSTHOG_API_HOST}/report/?token=${key}`
}

/** `report-uri` (navegadores antigos) e `report-to` (Reporting API), ou nada sem chave. */
function reportDirectives(options: CspOptions): string[] {
  return options.reportKey === undefined
    ? []
    : [`report-uri ${reportingEndpoint(options.reportKey)}`, `report-to ${REPORT_GROUP}`]
}

/** Headers de relatório do documento: o `Reporting-Endpoints` do grupo `posthog`, ou nada. */
function reportingHeaders(options: CspOptions): Record<string, string> {
  return options.reportKey === undefined
    ? {}
    : { 'Reporting-Endpoints': `${REPORT_GROUP}="${reportingEndpoint(options.reportKey)}"` }
}

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
 * concessão consciente para o Motion e os painéis redimensionáveis. Com a chave dos erros no build,
 * as violações vão ao PostHog Error Tracking (`report-uri` e `report-to`); sem ela, a CSP fica igual
 * e as violações só aparecem no console.
 */
export function contentSecurityPolicy(document: ParsedDocument, options: CspOptions = {}): string {
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
    ...reportDirectives(options),
  ].join('; ')
}

/** O Trusted Types em observação, com os mesmos relatórios da CSP quando há chave. */
export function trustedTypesReportOnly(options: CspOptions = {}): string {
  return [TRUSTED_TYPES_REPORT_ONLY, ...reportDirectives(options)].join('; ')
}

/** Headers que dependem do HTML, por arquivo do export (`en/index.html`, `404.html`...). */
export interface HeadersManifest {
  readonly version: 1
  readonly documents: Readonly<Record<string, Readonly<Record<string, string>>>>
}

/** Monta o manifesto; falha se a CSP de algum documento passar de `MAX_CSP_BYTES`. */
export function buildHeadersManifest(
  documents: ReadonlyMap<string, ParsedDocument>,
  options: CspOptions = {},
): HeadersManifest {
  const entries: [string, Record<string, string>][] = []
  const sorted = [...documents].sort(([a], [b]) => (a < b ? -1 : 1))
  const reportOnly = trustedTypesReportOnly(options)
  const reporting = reportingHeaders(options)
  for (const [file, document] of sorted) {
    const csp = contentSecurityPolicy(document, options)
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
        'Content-Security-Policy-Report-Only': reportOnly,
        ...reporting,
      },
    ])
  }
  return { version: 1, documents: Object.fromEntries(entries) }
}
