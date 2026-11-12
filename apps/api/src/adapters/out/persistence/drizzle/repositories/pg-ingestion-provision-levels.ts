/**
 * Nível de cada dispositivo pela cadeia de `parent` dentro do lote: 0 para quem não tem pai ou
 * cujo pai não está no lote (já existe no banco), e nível do pai + 1 para os demais. Os writers
 * inserem um comando por nível, então o pai sempre existe antes do comando que insere o filho.
 *
 * O número de segmentos da `stable_key` não serve de profundidade: o parser da REINF achata os
 * grupos do leiaute (`…:evt:R-2010:grupo:ideEstabObra` é filho de `…:evt:R-2010:grupo:infoServTom`,
 * com o mesmo número de segmentos).
 */

export interface ProvisionParentLink {
  readonly stableKey: string
  readonly parentStableKey: string | null
}

export class ProvisionCycleError extends Error {
  constructor(stableKey: string) {
    super(`ciclo na cadeia de pais a partir de ${stableKey}`)
    this.name = 'ProvisionCycleError'
  }
}

export function provisionLevels(rows: readonly ProvisionParentLink[]): ReadonlyMap<string, number> {
  const parentOf = new Map(rows.map((row) => [row.stableKey, row.parentStableKey]))
  const levels = new Map<string, number>()
  const levelOf = (start: string): number => {
    const chain: string[] = []
    const visiting = new Set<string>()
    let current: string | null | undefined = start
    let base = -1
    while (current !== null && current !== undefined && parentOf.has(current)) {
      const known = levels.get(current)
      if (known !== undefined) {
        base = known
        break
      }
      if (visiting.has(current)) {
        throw new ProvisionCycleError(start)
      }
      visiting.add(current)
      chain.push(current)
      current = parentOf.get(current)
    }
    for (const key of chain.reverse()) {
      base += 1
      levels.set(key, base)
    }
    return levels.get(start) ?? 0
  }
  for (const row of rows) {
    levelOf(row.stableKey)
  }
  return levels
}

/** Agrupa as linhas por nível, em ordem crescente (preserva a ordem dentro do nível). */
export function groupByLevel<T extends ProvisionParentLink>(rows: readonly T[]): T[][] {
  const levels = provisionLevels(rows)
  const groups = Map.groupBy(rows, (row) => levels.get(row.stableKey) ?? 0)
  return [...groups.keys()].sort((a, b) => a - b).map((level) => groups.get(level) ?? [])
}
