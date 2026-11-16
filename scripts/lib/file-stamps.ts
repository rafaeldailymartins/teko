import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Carimbo de um arquivo para o modo watch: data de modificação e tamanho. No Windows, o `fs.watch`
 * avisa também quando um arquivo só é lido (a data de último acesso muda), e o `node --watch`
 * reinicia com isso; comparar carimbos separa a leitura da mudança de verdade.
 */
type Stamp = string

const MISSING: Stamp = 'missing'
const DIRECTORY: Stamp = 'directory'

type StampReader = (path: string) => Stamp

export function stampOf(path: string): Stamp {
  try {
    const stats = statSync(path)
    return stats.isDirectory() ? DIRECTORY : `${stats.mtimeMs}:${stats.size}`
  } catch {
    return MISSING
  }
}

/** Todos os arquivos sob `dir`, com o caminho completo. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
}

/** Os carimbos conhecidos; `changed` diz se um aviso do watcher é mudança de verdade. */
export class FileStamps {
  readonly #stamps = new Map<string, Stamp>()
  readonly #read: StampReader

  constructor(read: StampReader = stampOf) {
    this.#read = read
  }

  seed(paths: Iterable<string>): void {
    for (const path of paths) this.#stamps.set(path, this.#read(path))
  }

  /**
   * Verdadeiro quando o arquivo foi criado, apagado ou mudou de data ou tamanho desde o último
   * carimbo (e o guarda); falso para leitura e para diretório, cujo aviso vem junto com o do
   * arquivo que mudou dentro dele.
   */
  changed(path: string): boolean {
    const next = this.#read(path)
    if (next === DIRECTORY) return false
    const previous = this.#stamps.get(path) ?? MISSING
    if (next === previous) return false
    if (next === MISSING) this.#stamps.delete(path)
    else this.#stamps.set(path, next)
    return true
  }
}
