import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Raiz do monorepo (a pasta do `pnpm-workspace.yaml`), achada subindo a partir deste arquivo. Um
 * caminho relativo fixo (`../../…/corpus`) aponta para dentro de `apps/api` quando o Stryker roda
 * os testes no sandbox (`apps/api/.stryker-tmp/sandbox-*`), que não copia o resto do repositório.
 */
function findRepoRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url))
  let dir = start
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml não encontrado acima de ${start}`)
    }
    dir = parent
  }
  return dir
}

const REPO_ROOT = findRepoRoot()

/** Caminho absoluto de um arquivo do repositório (ex.: `repoPath('corpus', 'watch.yaml')`). */
export function repoPath(...segments: string[]): string {
  return join(REPO_ROOT, ...segments)
}
