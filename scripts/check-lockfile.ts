/**
 * Guard do lockfile: o pnpm-lock.yaml precisa ser um ÚNICO documento YAML.
 * `devEngines.packageManager` e `configDependencies` geram um lockfile com dois documentos,
 * e o grafo de dependências do GitHub (logo, o Dependabot) deixa de lê-lo.
 * Uso: node scripts/check-lockfile.ts [caminho]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { argv, exit } from 'node:process'

const path = argv[2] ?? 'pnpm-lock.yaml'

let content: string
try {
  content = readFileSync(path, 'utf8')
} catch {
  console.error(`check-lockfile: ${path} não encontrado`)
  exit(1)
}

const separators = content.split(/\r?\n/).filter((line) => /^---\s*$/.test(line)).length

if (content.startsWith('---') || separators > 0) {
  console.error(
    `check-lockfile: ${path} tem ${separators} separador(es) de documento YAML. ` +
      'Remova devEngines.packageManager/configDependencies; o Dependabot exige um documento só.',
  )
  exit(1)
}

const forbidden = ['devEngines', 'configDependencies']
// O package.json verificado é o vizinho do lockfile (raiz ou projeto isolado, como tools/vercel-cli).
const manifest = join(dirname(path), 'package.json')
const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
const present = forbidden.filter((key) => key in pkg)
if (present.length > 0) {
  console.error(`check-lockfile: ${manifest} não pode declarar ${present.join(', ')}`)
  exit(1)
}

console.error(`check-lockfile: ${path} ok`)
