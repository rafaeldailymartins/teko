import { describe, expect, it } from 'vitest'
import ptBR from '../../../messages/pt-BR.json' with { type: 'json' }
import { CORPUS_AXIS_YEARS, LANDING_CORPUS, yearPosition } from './corpus.ts'

describe('régua do corpus da landing', () => {
  it('cada família tem nome e descrição no catálogo', () => {
    for (const { key } of LANDING_CORPUS) {
      expect(ptBR.landing.corpus[key].name).not.toBe('')
      expect(ptBR.landing.corpus[key].body).not.toBe('')
    }
  })

  it('os anos ficam dentro da régua, em posições crescentes', () => {
    expect(yearPosition(1990)).toBe(0)
    const axis = CORPUS_AXIS_YEARS.map(yearPosition)
    expect(axis).toEqual([...axis].sort((a, b) => a - b))
    for (const { since } of LANDING_CORPUS) {
      expect(yearPosition(since)).toBeGreaterThan(0)
      expect(yearPosition(since)).toBeLessThan(100)
    }
  })
})
