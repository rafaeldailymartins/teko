import fc from 'fast-check'
import { fromEpochDay, toEpochDay } from '../src/vigencia/iso-date.ts'
import { createInterval, type ValidityInterval } from '../src/vigencia/validity-interval.ts'

/**
 * Arbitrários compartilhados pelos testes de propriedade. A janela de datas é curta de propósito:
 * assim os intervalos gerados colidem, encostam e se sobrepõem com frequência.
 */
const WINDOW_START = toEpochDay('2020-01-01')
const WINDOW_DAYS = 120

const epochDayArb = fc.integer({ min: WINDOW_START, max: WINDOW_START + WINDOW_DAYS })

export const isoDateArb = epochDayArb.map(fromEpochDay)

/** Datas em toda a faixa suportada (anos 0001 a 9999), para conversões e calendário. */
export const anyIsoDateArb = fc
  .integer({ min: toEpochDay('0001-01-01'), max: toEpochDay('9999-12-31') })
  .map(fromEpochDay)

export const intervalArb: fc.Arbitrary<ValidityInterval> = fc
  .record({
    a: epochDayArb,
    b: epochDayArb,
    openLower: fc.boolean(),
    openUpper: fc.boolean(),
  })
  .filter(({ a, b }) => a !== b)
  .map(({ a, b, openLower, openUpper }) =>
    createInterval(
      openLower ? null : fromEpochDay(Math.min(a, b)),
      openUpper ? null : fromEpochDay(Math.max(a, b)),
    ),
  )

export const intervalListArb = fc.array(intervalArb, { maxLength: 8 })
