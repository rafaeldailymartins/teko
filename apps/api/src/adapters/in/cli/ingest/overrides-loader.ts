import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { indexOverrides, type Override, overrideFileSchema } from '#domain/corpus/overrides.ts'
import { compareCodeUnits } from './cli-common.ts'

/**
 * Lê `corpus/overrides/*.yaml` (cada arquivo, uma lista de resoluções; ver o exemplo e o schema em
 * `corpus/overrides/README.md`). Arquivos que começam com `_` (o exemplo) ficam de fora. A mesma
 * chave `(stable_key, note_hash)` em dois arquivos é erro.
 */

export class OverrideFileError extends Error {
  constructor(file: string, detail: string, options?: { readonly cause?: unknown }) {
    super(`override inválido: ${file}: ${detail}`, options)
    this.name = 'OverrideFileError'
  }
}

export function loadOverrides(dir: string): ReadonlyMap<string, Override> {
  if (!existsSync(dir)) {
    return new Map()
  }
  const all: Override[] = []
  const files = readdirSync(dir)
    .filter((name) => /\.ya?ml$/.test(name) && !name.startsWith('_'))
    .sort(compareCodeUnits)
  for (const name of files) {
    const file = join(dir, name)
    const raw: unknown = parseYaml(readFileSync(file, 'utf8'))
    const parsed = overrideFileSchema.safeParse(raw ?? [])
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`)
        .join('; ')
      throw new OverrideFileError(file, detail, { cause: parsed.error })
    }
    all.push(...parsed.data)
  }
  return indexOverrides(all)
}
