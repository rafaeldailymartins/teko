import { describe, expect, it } from 'vitest'
import { parseReference, referenceKeyDate, serializeReference } from './reference.ts'

describe('parseReference', () => {
  it('lê AAAA-MM como período de apuração', () => {
    expect(parseReference('2024-03')).toEqual({ periodoApuracao: '2024-03' })
  })

  it('lê AAAA-MM-DD como data exata', () => {
    expect(parseReference('2024-03-15')).toEqual({ referenceDate: '2024-03-15' })
  })

  it.each(['', '2024', '2024-13', '2023-02-29', '0000-01-01', '15/03/2024', '2024-03-15T00:00'])(
    'recusa %j',
    (value) => {
      expect(parseReference(value)).toBeNull()
    },
  )
})

describe('serializeReference', () => {
  it('devolve o próprio período ou a própria data', () => {
    expect(serializeReference({ periodoApuracao: '2024-03' })).toBe('2024-03')
    expect(serializeReference({ referenceDate: '2024-03-15' })).toBe('2024-03-15')
  })
})

describe('referenceKeyDate', () => {
  it('o período resolve para o dia 1, como na API', () => {
    expect(referenceKeyDate({ periodoApuracao: '2024-03' })).toBe('2024-03-01')
    expect(referenceKeyDate({ referenceDate: '2024-03-15' })).toBe('2024-03-15')
  })
})
