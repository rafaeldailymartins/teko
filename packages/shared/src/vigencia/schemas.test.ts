import { describe, expect, it } from 'vitest'
import {
  isoDateSchema,
  periodoApuracaoSchema,
  referenceSourceSchema,
  validityIntervalSchema,
} from './schemas.ts'

describe('schemas de vigência', () => {
  it('valida datas reais', () => {
    expect(isoDateSchema.safeParse('2024-02-29').success).toBe(true)
    expect(isoDateSchema.safeParse('2023-02-29').success).toBe(false)
    expect(isoDateSchema.safeParse('0000-01-01').success).toBe(false)
    expect(isoDateSchema.safeParse('2024-03-01T00:00:00Z').success).toBe(false)
  })

  it('valida o PA canônico', () => {
    expect(periodoApuracaoSchema.safeParse('2024-03').success).toBe(true)
    expect(periodoApuracaoSchema.safeParse('03/2024').success).toBe(false)
    expect(periodoApuracaoSchema.safeParse('2024-13').success).toBe(false)
  })

  it('valida a origem da data', () => {
    expect(referenceSourceSchema.parse('periodo_apuracao')).toBe('periodo_apuracao')
    expect(referenceSourceSchema.safeParse('today').success).toBe(false)
  })

  it('valida intervalos não vazios', () => {
    expect(validityIntervalSchema.parse({ from: '2024-01-01', to: null })).toEqual({
      from: '2024-01-01',
      to: null,
    })
    expect(validityIntervalSchema.safeParse({ from: null, to: null }).success).toBe(true)
    const inverted = validityIntervalSchema.safeParse({ from: '2024-01-01', to: '2024-01-01' })
    expect(inverted.success).toBe(false)
    expect(inverted.error?.issues[0]?.path).toEqual(['to'])
    expect(validityIntervalSchema.safeParse({ from: '2024-01-01' }).success).toBe(false)
  })
})
