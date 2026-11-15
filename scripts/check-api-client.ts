/**
 * Gate de drift do cliente da API no web: regenera o OpenAPI versionado (`apps/web/openapi.json`,
 * pela CLI da API, sem servidor nem banco) e o cliente gerado (`apps/web/src/lib/api/__generated__`,
 * pelo `@hey-api/openapi-ts` do lockfile) e falha se algum dos dois mudou em relação ao que está
 * no git (arquivo alterado, novo ou apagado). Uma rota ou um contrato do `@teko/shared` que muda
 * sem `pnpm --filter @teko/web api:generate` reprova aqui.
 *
 * Uso: node scripts/check-api-client.ts (sem argumentos). Roda no `pnpm verify` e no job `quality`
 * do CI. Deixa a árvore regenerada: depois de uma falha, basta conferir e commitar o resultado.
 * Código de saída: 0 em dia, 1 drift ou falha na geração, 2 erro de uso.
 */
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import process from 'node:process'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const WEB_DIR = join(REPO_ROOT, 'apps', 'web')

/** Caminhos gerados, relativos à raiz (o que o `git status` confere). */
export const GENERATED_PATHS = [
  'apps/web/openapi.json',
  'apps/web/src/lib/api/__generated__',
] as const

/** Arquivos com drift a partir do `git status --porcelain` (vazio = em dia). */
export function driftedFiles(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3))
}

function run(label: string, args: readonly string[], cwd: string): boolean {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`check-api-client: ${label} falhou (código ${String(result.status)})`)
    return false
  }
  return true
}

function main(): number {
  if (process.argv.length > 2) {
    console.error('check-api-client: sem argumentos.\nUso: node scripts/check-api-client.ts')
    return 2
  }
  const exported = run(
    'o export do OpenAPI',
    ['src/cli.ts', 'openapi', 'export'],
    join(REPO_ROOT, 'apps', 'api'),
  )
  if (!exported) {
    return 1
  }
  const generated = run(
    'o openapi-ts',
    [join(WEB_DIR, 'node_modules', '@hey-api', 'openapi-ts', 'bin', 'run.js')],
    WEB_DIR,
  )
  if (!generated) {
    return 1
  }
  const status = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', ...GENERATED_PATHS],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
  if (status.status !== 0) {
    console.error(`check-api-client: git status falhou\n${status.stderr}`)
    return 1
  }
  const drift = driftedFiles(status.stdout)
  if (drift.length > 0) {
    spawnSync('git', ['--no-pager', 'diff', '--stat', '--', ...GENERATED_PATHS], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
    })
    console.error(
      `check-api-client: o cliente da API está desatualizado em ${String(drift.length)} arquivo(s):\n` +
        drift.map((file) => `  ${file}`).join('\n') +
        '\nRode `pnpm --filter @teko/web api:generate` e commite o resultado.',
    )
    return 1
  }
  console.log('check-api-client: OpenAPI e cliente gerado em dia.')
  return 0
}

if (import.meta.main) {
  process.exitCode = main()
}
