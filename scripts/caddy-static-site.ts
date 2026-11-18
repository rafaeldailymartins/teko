/**
 * Gera os snippets do Caddy da stack de CI (`infra/ci/Caddyfile`) que servem o export do web com a
 * mesma semântica das rotas da Vercel (`scripts/build-vercel-output.ts`): a política vem do mesmo
 * `scripts/lib/static-site-policy.ts`, e a CSP de cada documento, do manifesto que o pós-build do web grava em `apps/web/out/.teko-headers.json`.
 *
 * - `(teko_static)`: headers de segurança, CSP por documento, `/_next/static/*` imutável, `/` →
 *   `/en/` ou `/pt-BR/` pelo `Accept-Language` (302, sem cache compartilhado), `/pt-br/...` →
 *   `/pt-BR/...` (308), barra final (308) e o `file_server`, que esconde o manifesto;
 * - `(teko_not_found)`: dentro do `handle_errors 404`, a página de 404 do locale do caminho (ou o
 *   `404.html`), com status 404 e a CSP dela.
 *
 * Saída: `infra/ci/.static-site.caddy` (fora do git), montado no container do Caddy. O
 * `infra/ci/up.sh` roda este script depois do build do web. Sem argumentos (código 2 com qualquer
 * um); falha de geração, código 1. Sem dependências: só o Node 24 (type stripping).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { compareCodeUnits, resolveInsideRoot } from './lib/cli-guards.ts'
import {
  ACCEPT_LANGUAGE_EN,
  type DocumentHeaders,
  documentPathPattern,
  HEADERS_MANIFEST_FILE,
  IMMUTABLE_CACHE_CONTROL,
  notFoundPageFor,
  parseHeadersManifest,
  ROOT_REDIRECT_HEADERS,
  STATIC_HEADERS,
  STATIC_LOCALES,
} from './lib/static-site-policy.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/** Raiz do export dentro do container do Caddy (`infra/ci/compose.yaml`). */
const CADDY_SITE_ROOT = '/srv'

class UsageError extends Error {}

/** Regex no Caddyfile entre crases (texto literal, sem escapes do Caddyfile). */
function literal(value: string): string {
  if (value.includes('`')) {
    throw new Error(`crase em valor do Caddyfile: ${value}`)
  }
  return `\`${value}\``
}

/**
 * Bloco `header { ... }` (com matcher opcional), valores entre aspas; o `Reporting-Endpoints`, cujo
 * valor tem aspas (`posthog="https://…"`), vai entre crases (texto literal no Caddyfile).
 */
function headerBlock(
  indent: string,
  headers: Readonly<Record<string, string>>,
  matcher = '',
): string[] {
  const lines = Object.entries(headers).map(([name, value]) => {
    if (/[\r\n]/.test(value)) {
      throw new Error(`valor de ${name} com quebra de linha`)
    }
    return `${indent}\t${name} ${value.includes('"') ? literal(value) : `"${value}"`}`
  })
  return [`${indent}header ${matcher}${matcher === '' ? '' : ' '}{`, ...lines, `${indent}}`]
}

/** Os dois snippets, a partir dos headers de cada documento do export. */
export function caddySnippets(documents: DocumentHeaders): string {
  const files = Object.keys(documents).sort(compareCodeUnits)
  const headersOf = (file: string): Readonly<Record<string, string>> => {
    const headers = documents[file]
    if (headers === undefined) {
      throw new Error(`${HEADERS_MANIFEST_FILE} não tem os headers de ${file}`)
    }
    return headers
  }
  const lines: string[] = [
    '# Gerado por scripts/caddy-static-site.ts (static-site-policy.ts + manifesto do export). Não edite.',
    '',
    '(teko_static) {',
    `\troot * ${CADDY_SITE_ROOT}`,
    '\troute {',
    ...headerBlock('\t\t', STATIC_HEADERS),
  ]
  // Sem distinção de caixa, ao contrário da Vercel: no Caddy o `header` substitui o valor, e a
  // página de 404 de `/EN/` (que não existe) troca a CSP do documento pela dela.
  files.forEach((file, index) => {
    const pattern = `(?i)${documentPathPattern(file)}`
    lines.push(`\t\t@document_${index} path_regexp ${literal(pattern)}`)
    lines.push(...headerBlock('\t\t', headersOf(file), `@document_${index}`))
  })
  lines.push(
    `\t\theader /_next/static/* Cache-Control "${IMMUTABLE_CACHE_CONTROL}"`,
    ...headerBlock('\t\t', ROOT_REDIRECT_HEADERS, '/'),
    '\t\t@root_en {',
    '\t\t\tpath /',
    `\t\t\theader_regexp Accept-Language ${literal(ACCEPT_LANGUAGE_EN)}`,
    '\t\t}',
    '\t\tredir @root_en /en/ 302',
    `\t\tredir / /${STATIC_LOCALES[0]}/ 302`,
    `\t\t@lowercase_pt_br path_regexp lowercase ${literal('^/pt-br(/.*)?$')}`,
    '\t\tredir @lowercase_pt_br /pt-BR{re.lowercase.1} 308',
    `\t\t@no_slash path_regexp no_slash ${literal('^/((?:[^/]+/)*[^/.]+)$')}`,
    '\t\tredir @no_slash /{re.no_slash.1}/ 308',
    // Os source maps ficam no export para o deploy e nunca são servidos (ADR 0037).
    '\t\t@source_map path_regexp source_map `(?i)\\.map$`',
    '\t\terror @source_map 404',
    '\t\tfile_server {',
    `\t\t\thide ${HEADERS_MANIFEST_FILE}`,
    '\t\t}',
    '\t}',
    '}',
    '',
    '(teko_not_found) {',
    `\troot * ${CADDY_SITE_ROOT}`,
    ...headerBlock('\t', STATIC_HEADERS),
  )
  for (const locale of STATIC_LOCALES) {
    const page = notFoundPageFor(`/${locale}/`)
    lines.push(
      `\t@not_found_${locale.replace('-', '_')} path_regexp ${literal(`(?i)^/${locale}(?:/.*)?$`)}`,
      `\thandle @not_found_${locale.replace('-', '_')} {`,
      ...headerBlock('\t\t', headersOf(page)),
      `\t\trewrite * /${page}`,
      '\t\tfile_server',
      '\t}',
    )
  }
  const rootPage = notFoundPageFor('/')
  lines.push(
    '\thandle {',
    ...headerBlock('\t\t', headersOf(rootPage)),
    `\t\trewrite * /${rootPage}`,
    '\t\tfile_server',
    '\t}',
    '}',
    '',
  )
  return lines.join('\n')
}

function main(): void {
  try {
    parseArgs({ options: {}, strict: true, allowPositionals: false })
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const inside = (...segments: string[]) =>
    resolveInsideRoot(REPO_ROOT, join(REPO_ROOT, ...segments), REPO_ROOT)
  const manifest = inside('apps', 'web', 'out', HEADERS_MANIFEST_FILE)
  let raw: string
  try {
    raw = readFileSync(manifest, 'utf8')
  } catch {
    throw new Error(`${manifest} não existe; rode \`pnpm --filter @teko/web build\` antes`)
  }
  const documents = parseHeadersManifest(JSON.parse(raw))
  writeFileSync(inside('infra', 'ci', '.static-site.caddy'), caddySnippets(documents))
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(`caddy-static-site: ${error instanceof Error ? error.message : String(error)}`)
    if (error instanceof UsageError) {
      console.error('uso: node scripts/caddy-static-site.ts (sem argumentos)')
    }
    process.exitCode = error instanceof UsageError ? 2 : 1
  }
}
