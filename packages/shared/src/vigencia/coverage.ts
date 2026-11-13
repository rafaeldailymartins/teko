import { addDays, type IsoDate } from './iso-date.ts'
import {
  containsDate,
  createInterval,
  intersect,
  mergeIntervals,
  overlaps,
  type ValidityInterval,
} from './validity-interval.ts'

/**
 * Cobertura do corpus: conjunto de intervalos (um `datemultirange` por família) em que o Tekó
 * tem fontes verificadas. Uma data fora da cobertura leva a `refused/out_of_coverage` sem LLM.
 */

/** Intervalo da lista que contém a data, se houver. */
export function findCoveringInterval(
  date: IsoDate,
  covered: readonly ValidityInterval[],
): ValidityInterval | undefined {
  return covered.find((interval) => containsDate(interval, date))
}

/** A data está dentro de algum intervalo coberto. */
export function isDateCovered(date: IsoDate, covered: readonly ValidityInterval[]): boolean {
  return findCoveringInterval(date, covered) !== undefined
}

function subtractOne(base: ValidityInterval, gap: ValidityInterval): ValidityInterval[] {
  if (!overlaps(base, gap)) {
    return [base]
  }
  const pieces: ValidityInterval[] = []
  if (gap.from !== null && (base.from === null || base.from < gap.from)) {
    pieces.push(createInterval(base.from, gap.from))
  }
  if (gap.to !== null && (base.to === null || gap.to < base.to)) {
    pieces.push(createInterval(gap.to, base.to))
  }
  return pieces
}

/** Diferença de conjuntos (operador `-` de multirange): `base` sem os trechos de `gaps`. */
export function subtractIntervals(
  base: readonly ValidityInterval[],
  gaps: readonly ValidityInterval[],
): ValidityInterval[] {
  const remaining = gaps.reduce<ValidityInterval[]>(
    (acc, gap) => acc.flatMap((interval) => subtractOne(interval, gap)),
    mergeIntervals(base),
  )
  return mergeIntervals(remaining)
}

/**
 * Cobertura efetiva de uma família:
 * `covered * datemultirange(daterange(NULL, verified_at + 1)) - gaps`.
 * Datas posteriores a `verifiedAt` ficam de fora mesmo que o intervalo coberto esteja em aberto.
 */
export function effectiveCoverage(
  covered: readonly ValidityInterval[],
  verifiedAt: IsoDate,
  gaps: readonly ValidityInterval[] = [],
): ValidityInterval[] {
  const verifiedWindow = createInterval(null, addDays(verifiedAt, 1))
  const bounded = covered
    .map((interval) => intersect(interval, verifiedWindow))
    .filter((interval): interval is ValidityInterval => interval !== null)
  return subtractIntervals(bounded, gaps)
}
