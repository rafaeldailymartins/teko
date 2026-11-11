/**
 * Guardas dos scripts da raiz. Os scripts rodam no CI e em máquinas de dev com argumentos que
 * podem vir de um humano, de um workflow ou de um agente, e por isso nenhum caminho de arquivo nem
 * executável vem da linha de comando: os scripts aceitam no máximo opções de um conjunto constante
 * (ex.: `--env production|staging`), e todo caminho é uma constante derivada da raiz do
 * repositório. Os helpers daqui são a defesa em profundidade sobre essas constantes:
 *
 * - caminho de arquivo: aceito só se o caminho REAL (links simbólicos e junctions resolvidos)
 *   ficar dentro da raiz do repositório (`resolveInsideRoot`);
 * - executável: nunca um nome que o sistema procure no PATH. `findOnSafePath` devolve o caminho
 *   absoluto achado só em diretórios absolutos do PATH (entradas relativas ou vazias resolveriam
 *   contra o cwd, e o Windows ainda procura no cwd antes do PATH) e, no POSIX, que não sejam
 *   graváveis por todos.
 *
 * Os testes ficam em `scripts/lib/cli-guards.test.ts` (`pnpm test:scripts`).
 */
import { accessSync, constants, lstatSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'
import process from 'node:process'

export class CliGuardError extends Error {
  override readonly name = 'CliGuardError'
}

/**
 * Comparador explícito para `sort`: ordem de unidade de código UTF-16 (a mesma do `sort()` sem
 * argumento), total, estável entre máquinas e independente de locale. `localeCompare` mudaria com
 * o ICU e o idioma do runner, e quebraria artefatos determinísticos.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}

function isWithin(base: string, target: string): boolean {
  const fromBase = relative(base, target)
  return (
    fromBase === '' ||
    (!isAbsolute(fromBase) && fromBase !== '..' && !fromBase.startsWith(`..${sep}`))
  )
}

/** Caminho real de `target`: o maior ancestral existente com links resolvidos, mais o resto. */
function realPathOf(target: string): string {
  let existing = target
  while (lstatSync(existing, { throwIfNoEntry: false }) === undefined) {
    const parent = dirname(existing)
    if (parent === existing) {
      break
    }
    existing = parent
  }
  // Link pendurado: o `realpath` lança, e o write seguiria o link para qualquer lugar.
  return join(realpathSync.native(existing), relative(existing, target))
}

/**
 * Resolve `candidate` (relativo a `cwd`) e devolve o caminho absoluto se, com todos os links
 * resolvidos, ele ficar dentro de `root`. Recusa subida (`..`), caminho absoluto de fora, link ou
 * junction para fora (inclusive no meio do caminho de um arquivo ainda inexistente) e link
 * pendurado. O caminho devolvido é absoluto: nunca começa com `-`, então não vira opção de outro
 * programa quando repassado como argumento.
 */
export function resolveInsideRoot(root: string, candidate: string, cwd = process.cwd()): string {
  if (candidate.trim() === '' || candidate.includes('\0')) {
    throw new CliGuardError('caminho vazio ou com byte nulo')
  }
  const target = resolve(cwd, candidate)
  let realTarget: string
  try {
    realTarget = realPathOf(target)
  } catch {
    throw new CliGuardError(`${candidate}: link simbólico quebrado ou caminho ilegível`)
  }
  const realRoot = realpathSync.native(resolve(root))
  if (!isWithin(realRoot, realTarget)) {
    throw new CliGuardError(`${candidate}: fora do repositório (${realRoot})`)
  }
  return target
}

interface ExecutableSearch {
  /** Valor do PATH (no Windows o `process.env` já ignora a caixa de `Path`). */
  readonly pathEnv: string | undefined
  readonly platform: NodeJS.Platform
}

function currentSearch(): ExecutableSearch {
  return { pathEnv: process.env['PATH'], platform: process.platform }
}

/** Nome simples de programa: sem separador, sem espaço, sem começar com `-` ou `.`. */
const PROGRAM_NAME = /^[A-Za-z0-9][\w.-]*$/

function isTrustedDirectory(dir: string, platform: NodeJS.Platform): boolean {
  const stat = statSync(dir, { throwIfNoEntry: false })
  if (stat?.isDirectory() !== true) {
    return false
  }
  // No POSIX, diretório gravável por todos (ex.: /tmp) permite plantar o binário. No Windows o modo
  // POSIX não existe; as ACLs dos diretórios absolutos do PATH do sistema ficam com o admin.
  return platform === 'win32' || (stat.mode & 0o002) === 0
}

function isExecutableFile(file: string, platform: NodeJS.Platform): boolean {
  if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
    return false
  }
  if (platform === 'win32') {
    return true
  }
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableFileName(name: string, platform: NodeJS.Platform): string {
  // Só `.exe` no Windows: `.cmd`/`.bat` exigem shell, e o spawn aqui é sempre sem shell.
  return platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name
}

/**
 * Caminho absoluto de `name` no PATH, considerando só diretórios absolutos, existentes e (no POSIX)
 * não graváveis por todos. Lança `CliGuardError` se o nome não for simples ou se não achar.
 */
export function findOnSafePath(name: string, search: ExecutableSearch = currentSearch()): string {
  if (!PROGRAM_NAME.test(name)) {
    throw new CliGuardError(`nome de programa inválido: ${JSON.stringify(name)}`)
  }
  const paths = search.platform === 'win32' ? win32 : posix
  const fileName = executableFileName(name, search.platform)
  for (const dir of (search.pathEnv ?? '').split(paths.delimiter)) {
    if (!paths.isAbsolute(dir) || !isTrustedDirectory(dir, search.platform)) {
      continue
    }
    const candidate = paths.join(dir, fileName)
    if (isExecutableFile(candidate, search.platform)) {
      return candidate
    }
  }
  throw new CliGuardError(`${name} não encontrado em nenhum diretório absoluto e protegido do PATH`)
}
