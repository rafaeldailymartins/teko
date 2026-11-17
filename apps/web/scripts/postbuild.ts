/**
 * Pós-build do web (`pnpm --filter @teko/web build` = `next build` + este script). Roda sobre o
 * `.next` e o `out/` recém-gerados e falha (código 1) se:
 *
 * 1. o código ou o build tiver algo fora do export estático puro (`lib/static-guard.ts`);
 * 2. a CSP de algum documento passar de 6 KB (`lib/csp.ts`);
 * 3. o JS do primeiro acesso passar do orçamento de `bundle-budget.json` (`lib/bundle-budget.ts`).
 *
 * Grava `out/.teko-headers.json`, o manifesto com a CSP (hashes dos `<script>` e `<style>` inline), o
 * Trusted Types report-only e, com `NEXT_PUBLIC_POSTHOG_ERRORS_KEY`, o `report-to` e o
 * `Reporting-Endpoints` do PostHog de cada HTML, que a Vercel, o Plano B e o Caddy da stack de CI
 * aplicam por caminho. Sem argumentos; idempotente (o CI roda de novo depois de um cache hit do
 * turbo). Uso: `node scripts/postbuild.ts`, em `apps/web`.
 */
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { assertWithinBudget, measureFirstLoad, readBudget } from './lib/bundle-budget.ts'
import { buildHeadersManifest, HEADERS_MANIFEST_FILE } from './lib/csp.ts'
import { readDocuments } from './lib/html.ts'
import { findNonStaticOutput, findServerOnlySources } from './lib/static-guard.ts'

const WEB_DIR = resolve(import.meta.dirname, '..')

function main(): void {
  const violations = [...findServerOnlySources(WEB_DIR), ...findNonStaticOutput(WEB_DIR)]
  if (violations.length > 0) {
    throw new Error(`o build do web não é só estático:\n  ${violations.join('\n  ')}`)
  }
  const outDir = join(WEB_DIR, 'out')
  const documents = readDocuments(outDir)
  // A mesma chave pública que o build inlina para o cliente de erros (ADR 0037): com ela, a CSP e
  // o Trusted Types mandam as violações ao PostHog; sem ela, a CSP fica como estava.
  const reportKey = process.env['NEXT_PUBLIC_POSTHOG_ERRORS_KEY']?.trim() || undefined
  const manifest = buildHeadersManifest(documents, { reportKey })
  writeFileSync(join(outDir, HEADERS_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`)
  const measure = measureFirstLoad(outDir, documents)
  const budget = readBudget(join(WEB_DIR, 'bundle-budget.json'))
  const cspBytes = Object.values(manifest.documents).map((headers) =>
    Buffer.byteLength(headers['Content-Security-Policy'] ?? '', 'utf8'),
  )
  process.stdout.write(
    `${JSON.stringify({
      documents: documents.size,
      maxCspBytes: Math.max(0, ...cspBytes),
      firstLoadJsGzipKiB: Number((measure.totalGzipBytes / 1024).toFixed(1)),
      budgetKiB: budget.firstLoadJsGzipKiB,
    })}\n`,
  )
  assertWithinBudget(measure, budget)
}

try {
  main()
} catch (error) {
  console.error(`postbuild do web: ${error instanceof Error ? error.message : String(error)}`)
  // `exitCode` em vez de `exit()`: no Windows, sair com o stderr pendente aborta o Node.
  process.exitCode = 1
}
