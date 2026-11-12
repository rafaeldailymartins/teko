import { describe, expect, it } from 'vitest'
import {
  groupByLevel,
  ProvisionCycleError,
  provisionLevels,
} from './pg-ingestion-provision-levels.ts'

const R2010 = 'br:efd-reinf:evt:R-2010'

describe('provisionLevels', () => {
  it('mede o nível pela cadeia de pais, não pelo número de segmentos', () => {
    const levels = provisionLevels([
      { stableKey: `${R2010}:grupo:ideEstabObra`, parentStableKey: `${R2010}:grupo:infoServTom` },
      { stableKey: `${R2010}:grupo:infoServTom`, parentStableKey: R2010 },
      { stableKey: R2010, parentStableKey: null },
      {
        stableKey: `${R2010}:grupo:ideEstabObra:campo:tpInscEstab`,
        parentStableKey: `${R2010}:grupo:ideEstabObra`,
      },
    ])
    expect(Object.fromEntries(levels)).toEqual({
      [R2010]: 0,
      [`${R2010}:grupo:infoServTom`]: 1,
      [`${R2010}:grupo:ideEstabObra`]: 2,
      [`${R2010}:grupo:ideEstabObra:campo:tpInscEstab`]: 3,
    })
  })

  it('pai fora do lote (já no banco) conta como raiz', () => {
    const levels = provisionLevels([
      { stableKey: 'go:rcte:art:1:par:1', parentStableKey: 'go:rcte:art:1' },
      { stableKey: 'go:rcte:art:1:par:1:inc:I', parentStableKey: 'go:rcte:art:1:par:1' },
    ])
    expect([...levels.values()]).toEqual([0, 1])
  })

  it('recusa ciclos', () => {
    expect(() =>
      provisionLevels([
        { stableKey: 'a', parentStableKey: 'b' },
        { stableKey: 'b', parentStableKey: 'a' },
      ]),
    ).toThrow(ProvisionCycleError)
  })

  it('groupByLevel devolve os níveis em ordem, preservando a ordem de entrada', () => {
    const groups = groupByLevel([
      { stableKey: 'c', parentStableKey: 'b' },
      { stableKey: 'x', parentStableKey: null },
      { stableKey: 'b', parentStableKey: 'a' },
      { stableKey: 'a', parentStableKey: null },
    ])
    expect(groups.map((group) => group.map((row) => row.stableKey))).toEqual([
      ['x', 'a'],
      ['b'],
      ['c'],
    ])
  })
})
