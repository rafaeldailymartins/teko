/**
 * Ordem de unidade de código UTF-16 (a mesma do `sort()` sem argumento), explícita: chaves,
 * hosts e datas ISO ordenam igual em qualquer host, sem depender do locale nem do ICU.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  return a > b ? 1 : 0
}
