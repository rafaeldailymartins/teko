import { addDays, compareIsoDates, type IsoDate, isIsoDate } from './iso-date.ts'

/**
 * Intervalo de vigência com a semântica do `daterange` canônico do Postgres: `[from, to)`,
 * limite inferior inclusivo e superior exclusivo.
 *
 * - `to === null` significa "em vigor" (sem limite superior, `upper_inf`).
 * - `from === null` significa "sem limite inferior" (`lower_inf`), usado por exemplo em
 *   `daterange(NULL, verified_at + 1)` no cálculo de cobertura.
 * - Intervalos vazios não são representados: as funções que podem produzi-los devolvem `null`.
 */
export interface ValidityInterval {
  readonly from: IsoDate | null
  readonly to: IsoDate | null
}

function assertBound(value: IsoDate | null, name: 'from' | 'to'): void {
  if (value !== null && !isIsoDate(value)) {
    throw new RangeError(`Limite "${name}" inválido: ${JSON.stringify(value)}`)
  }
}

/** `true` quando `from < to` (ou algum dos limites é aberto). */
export function isNonEmptyInterval(from: IsoDate | null, to: IsoDate | null): boolean {
  return from === null || to === null || from < to
}

/** Cria um intervalo `[from, to)` validado e imutável; lança `RangeError` se vazio ou inválido. */
export function createInterval(from: IsoDate | null, to: IsoDate | null): ValidityInterval {
  assertBound(from, 'from')
  assertBound(to, 'to')
  if (!isNonEmptyInterval(from, to)) {
    throw new RangeError(`Intervalo vazio ou invertido: [${String(from)}, ${String(to)})`)
  }
  return Object.freeze({ from, to })
}

/** Intervalo de um único dia: `[date, date + 1)`. */
export function singleDayInterval(date: IsoDate): ValidityInterval {
  return createInterval(date, addDays(date, 1))
}

/** Sem limite superior: dispositivo ainda em vigor. */
export function isOpenEnded(interval: ValidityInterval): boolean {
  return interval.to === null
}

/** `from <= date < to`, tratando limites `null` como infinitos. */
export function containsDate(interval: ValidityInterval, date: IsoDate): boolean {
  return (
    (interval.from === null || interval.from <= date) &&
    (interval.to === null || date < interval.to)
  )
}

/** Limite inferior `a` vem antes do limite superior `b` (null inferior = -∞, null superior = +∞). */
function lowerBeforeUpper(lower: IsoDate | null, upper: IsoDate | null): boolean {
  return lower === null || upper === null || lower < upper
}

/** Equivalente ao operador `&&` do Postgres. */
export function overlaps(a: ValidityInterval, b: ValidityInterval): boolean {
  return lowerBeforeUpper(a.from, b.to) && lowerBeforeUpper(b.from, a.to)
}

/** Equivalente ao operador `-|-` do Postgres: os intervalos se tocam sem se sobrepor. */
export function isAdjacent(a: ValidityInterval, b: ValidityInterval): boolean {
  return (a.to !== null && a.to === b.from) || (b.to !== null && b.to === a.from)
}

function maxLower(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) {
    return b
  }
  if (b === null) {
    return a
  }
  return a > b ? a : b
}

function minUpper(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null) {
    return b
  }
  if (b === null) {
    return a
  }
  return a < b ? a : b
}

function maxUpper(a: IsoDate | null, b: IsoDate | null): IsoDate | null {
  if (a === null || b === null) {
    return null
  }
  return a > b ? a : b
}

/** Equivalente ao operador `*` do Postgres; `null` quando a interseção é vazia. */
export function intersect(a: ValidityInterval, b: ValidityInterval): ValidityInterval | null {
  const from = maxLower(a.from, b.from)
  const to = minUpper(a.to, b.to)
  return isNonEmptyInterval(from, to) ? Object.freeze({ from, to }) : null
}

/** `inner` está inteiramente contido em `outer` (operador `@>` entre ranges). */
export function containsInterval(outer: ValidityInterval, inner: ValidityInterval): boolean {
  const lowerOk = outer.from === null || (inner.from !== null && outer.from <= inner.from)
  const upperOk = outer.to === null || (inner.to !== null && inner.to <= outer.to)
  return lowerOk && upperOk
}

function compareLower(a: IsoDate | null, b: IsoDate | null): -1 | 0 | 1 {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? -1 : 1
  }
  return compareIsoDates(a, b)
}

function compareUpper(a: IsoDate | null, b: IsoDate | null): -1 | 0 | 1 {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1
  }
  return compareIsoDates(a, b)
}

/** Ordem total dos ranges do Postgres: primeiro pelo limite inferior, depois pelo superior. */
export function compareIntervals(a: ValidityInterval, b: ValidityInterval): -1 | 0 | 1 {
  const byLower = compareLower(a.from, b.from)
  return byLower === 0 ? compareUpper(a.to, b.to) : byLower
}

export function intervalsEqual(a: ValidityInterval, b: ValidityInterval): boolean {
  return a.from === b.from && a.to === b.to
}

/**
 * Forma canônica de um conjunto de intervalos (como um `datemultirange`): ordena e funde
 * intervalos que se sobrepõem ou são adjacentes. O resultado é disjunto, não adjacente e ordenado.
 */
export function mergeIntervals(intervals: readonly ValidityInterval[]): ValidityInterval[] {
  const sorted = [...intervals].sort(compareIntervals)
  const merged: ValidityInterval[] = []
  for (const current of sorted) {
    const last = merged.at(-1)
    if (last !== undefined && (overlaps(last, current) || isAdjacent(last, current))) {
      merged[merged.length - 1] = Object.freeze({
        from: last.from,
        to: maxUpper(last.to, current.to),
      })
    } else {
      merged.push(Object.freeze({ from: current.from, to: current.to }))
    }
  }
  return merged
}

/**
 * Último dia incluído no intervalo (`to - 1`), como a UI exibe ("01/01/2024–31/12/2024");
 * `null` quando o intervalo está em vigor.
 */
export function lastIncludedDay(interval: ValidityInterval): IsoDate | null {
  return interval.to === null ? null : addDays(interval.to, -1)
}
