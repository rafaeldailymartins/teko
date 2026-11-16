/**
 * Modo watch do `dev` da API, no lugar do `node --watch`.
 *
 * No Windows, o `fs.watch` avisa também quando um arquivo só é lido (muda a data de último
 * acesso). Com o `node --watch`, rodar testes, typecheck ou lint com a API de pé a reiniciava a cada
 * leitura, e a sessão aberta no navegador caía no meio. Aqui o aviso só reinicia quando a data de
 * modificação ou o tamanho do arquivo mudam (`scripts/lib/file-stamps.ts`).
 *
 * Uso: node dev-watch.ts --watch <dir> [--watch <dir>...] -- <argumentos do node>
 * Ex.: node ../../scripts/dev-watch.ts --watch src -- --env-file-if-exists=.env src/server.ts
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { watch } from 'node:fs'
import { join, resolve } from 'node:path'
import { argv, execPath, exit } from 'node:process'
import { FileStamps, listFiles } from './lib/file-stamps.ts'

const RESTART_DEBOUNCE_MS = 150

const separator = argv.indexOf('--')
const options = separator === -1 ? argv.slice(2) : argv.slice(2, separator)
const nodeArgs = separator === -1 ? [] : argv.slice(separator + 1)
const dirs: string[] = []
for (const [index, option] of options.entries()) {
  const dir = options[index + 1]
  if (option === '--watch' && dir !== undefined) dirs.push(resolve(dir))
}

if (dirs.length === 0 || nodeArgs.length === 0) {
  console.error('Uso: node dev-watch.ts --watch <dir> [--watch <dir>...] -- <argumentos do node>')
  exit(2)
}

const stamps = new FileStamps()
for (const dir of dirs) stamps.seed(listFiles(dir))

let child: ChildProcess | undefined
let stopping = false
let pending: NodeJS.Timeout | undefined
const changedFiles = new Set<string>()

function start(): void {
  const current = spawn(execPath, nodeArgs, { stdio: 'inherit' })
  child = current
  current.on('exit', (code, signal) => {
    if (child !== current) return
    child = undefined
    if (!stopping) {
      console.error(`[dev-watch] o processo saiu (${signal ?? code}); esperando uma mudança.`)
    }
  })
}

function restart(): void {
  const files = [...changedFiles].join(', ')
  changedFiles.clear()
  console.log(`[dev-watch] reiniciando: ${files}`)
  const previous = child
  if (previous === undefined) {
    start()
    return
  }
  child = undefined
  previous.once('exit', start)
  previous.kill()
}

for (const dir of dirs) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (file === null) return
    const path = join(dir, file)
    if (!stamps.changed(path)) return
    changedFiles.add(file)
    clearTimeout(pending)
    pending = setTimeout(restart, RESTART_DEBOUNCE_MS)
  })
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true
    clearTimeout(pending)
    if (child === undefined) exit(0)
    child.once('exit', () => exit(0))
    child.kill(signal)
  })
}

start()
