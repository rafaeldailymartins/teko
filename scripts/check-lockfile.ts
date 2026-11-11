/**
 * Guard do lockfile: o pnpm-lock.yaml precisa ser um ÚNICO documento YAML.
 * `devEngines.packageManager` e `configDependencies` geram um lockfile com dois documentos,
 * e o grafo de dependências do GitHub (logo, o Dependabot) deixa de lê-lo.
 * Uso: node scripts/check-lockfile.ts [caminho]
 *
 * O caminho (relativo ao cwd) precisa ficar dentro do repositório, com links resolvidos: o script
 * só lê lockfiles do próprio repositório (o da raiz e o de projetos isolados, como tools/vercel-cli).
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { argv, exit } from 'node:process'
import { resolveInsideRoot } from './lib/cli-guards.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const argument = argv[2] ?? 'pnpm-lock.yaml'

/** Caminho absoluto dentro do repositório; fora dele, o script termina com código 1. */
function insideRepo(candidate: string): string {
  try {
    return resolveInsideRoot(REPO_ROOT, candidate)
  } catch (error) {
    console.error(`check-lockfile: ${error instanceof Error ? error.message : String(error)}`)
    return exit(1)
  }
}

const path = insideRepo(argument)

let content: string
try {
  content = readFileSync(path, 'utf8')
} catch {
  console.error(`check-lockfile: ${argument} não encontrado`)
  exit(1)
}

const separators = content.split(/\r?\n/).filter((line) => /^---\s*$/.test(line)).length

if (content.startsWith('---') || separators > 0) {
  console.error(
    `check-lockfile: ${argument} tem ${separators} separador(es) de documento YAML. ` +
      'Remova devEngines.packageManager/configDependencies; o Dependabot exige um documento só.',
  )
  exit(1)
}

const forbidden = ['devEngines', 'configDependencies']
// O package.json verificado é o vizinho do lockfile (raiz ou projeto isolado, como tools/vercel-cli),
// e passa pela mesma guarda (um link simbólico no lugar dele também não sai do repositório).
const manifest = insideRepo(join(dirname(path), 'package.json'))
const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
const present = forbidden.filter((key) => key in pkg)
if (present.length > 0) {
  console.error(`check-lockfile: ${manifest} não pode declarar ${present.join(', ')}`)
  exit(1)
}

console.error(`check-lockfile: ${argument} ok`)
