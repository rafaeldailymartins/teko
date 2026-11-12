import { describe, expect, it } from 'vitest'
import { compareCodeUnits } from './compare-code-units.ts'

describe('compareCodeUnits', () => {
  it('ordena por unidade de código, maiúsculas antes de minúsculas e sem locale', () => {
    expect(['b', 'a', 'B', 'á', 'a'].sort(compareCodeUnits)).toEqual(['B', 'a', 'a', 'b', 'á'])
  })

  it('devolve -1, 0 e 1', () => {
    expect(compareCodeUnits('a', 'b')).toBe(-1)
    expect(compareCodeUnits('b', 'b')).toBe(0)
    expect(compareCodeUnits('c', 'b')).toBe(1)
  })
})
