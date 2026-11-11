/**
 * Guard do lockfile: cada pnpm-lock.yaml do repositório precisa ser um ÚNICO documento YAML.
 * `devEngines.packageManager` e `configDependencies` geram um lockfile com dois documentos,
 * e o grafo de dependências do GitHub (logo, o Dependabot) deixa de lê-lo.
 * Uso: node scripts/check-lockfile.ts (sem argumentos)
 *
 * Os lockfiles verificados são uma lista fixa (`LOCKFILE_DIRS`), resolvida a partir do próprio
 * script: o da raiz e os dos projetos isolados `tools/vercel-cli` e `tools/netlify-cli`, cada um
 * com o `package.json` vizinho. O script não aceita caminho na linha de comando; qualquer argumento é erro de uso
 * (código 2), e nenhum valor da linha de comando chega a uma leitura de arquivo.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
/** Diretórios (relativos à raiz) com lockfile próprio; o `package.json` vizinho também é lido. */
const LOCKFILE_DIRS = ['.', 'tools/vercel-cli', 'tools/netlify-cli'] as const
const FORBIDDEN_KEYS = ['devEngines', 'configDependencies'] as const

const labelOf = (dir: string): string => (dir === '.' ? 'pnpm-lock.yaml' : `${dir}/pnpm-lock.yaml`)

/** Problemas do lockfile de `dir` e do `package.json` vizinho; vazio quando os dois estão ok. */
function problemsOf(dir: (typeof LOCKFILE_DIRS)[number]): string[] {
  const label = labelOf(dir)
  // Defesa em profundidade: os caminhos são constantes, mas um link simbólico no lugar de um deles
  // também não pode levar a leitura para fora do repositório.
  const lockfile = resolveInsideRoot(REPO_ROOT, join(dir, 'pnpm-lock.yaml'), REPO_ROOT)
  const manifest = resolveInsideRoot(REPO_ROOT, join(dir, 'package.json'), REPO_ROOT)
  let content: string
  try {
    content = readFileSync(lockfile, 'utf8')
  } catch {
    return [`${label} não encontrado`]
  }
  const problems: string[] = []
  const separators = content.split(/\r?\n/).filter((line) => /^---\s*$/.test(line)).length
  if (content.startsWith('---') || separators > 0) {
    problems.push(
      `${label} tem ${separators} separador(es) de documento YAML. ` +
        'Remova devEngines.packageManager/configDependencies; o Dependabot exige um documento só.',
    )
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
  const present = FORBIDDEN_KEYS.filter((key) => key in pkg)
  if (present.length > 0) {
    problems.push(`o package.json vizinho de ${label} não pode declarar ${present.join(', ')}`)
  }
  return problems
}

/** Código de saída: 0 ok, 1 lockfile inválido, 2 erro de uso. */
function main(): number {
  if (process.argv.length > 2) {
    console.error(
      'check-lockfile: este script não aceita argumentos; ele verifica sempre ' +
        `${LOCKFILE_DIRS.map(labelOf).join(' e ')}.\nUso: node scripts/check-lockfile.ts`,
    )
    return 2
  }
  let failed = false
  for (const dir of LOCKFILE_DIRS) {
    let problems: string[]
    try {
      problems = problemsOf(dir)
    } catch (error) {
      problems = [error instanceof Error ? error.message : String(error)]
    }
    for (const problem of problems) {
      console.error(`check-lockfile: ${problem}`)
    }
    if (problems.length === 0) {
      console.error(`check-lockfile: ${labelOf(dir)} ok`)
    }
    failed ||= problems.length > 0
  }
  return failed ? 1 : 0
}

// `exitCode` em vez de `exit()`: no Windows, sair com a escrita no stderr ainda pendente pode
// abortar o Node (assert do libuv) e trocar o código de saída.
process.exitCode = main()
