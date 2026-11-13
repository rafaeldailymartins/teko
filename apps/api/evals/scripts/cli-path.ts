import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Caminho de arquivo recebido por argumento de CLI nos scripts de eval, resolvido contra o
 * diretório de trabalho (`apps/api` no CI). Recusa o que sair dele (`..`, caminho absoluto em
 * outro lugar): os scripts só leem e gravam relatórios em `reports/`.
 */
export function cliPath(argument: string, base: string = process.cwd()): string {
  const root = resolve(base)
  const target = resolve(root, argument)
  const inside = relative(root, target)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`caminho fora do diretório de trabalho: ${argument}`)
  }
  return target
}
