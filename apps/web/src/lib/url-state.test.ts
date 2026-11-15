import { isParserBijective } from 'nuqs/testing'
import { describe, expect, it } from 'vitest'
import { chatSearchParams } from './url-state.ts'

const QUESTION_ID = '0193a3b0-7c1e-7b3a-9f00-4c2d1e5f6a7b'

describe('chatSearchParams', () => {
  it('q e c aceitam só UUID', () => {
    expect(chatSearchParams.q.parse(QUESTION_ID)).toBe(QUESTION_ID)
    expect(chatSearchParams.c.parse(QUESTION_ID)).toBe(QUESTION_ID)
    expect(chatSearchParams.q.parse('123')).toBeNull()
    expect(chatSearchParams.c.parse('<script>')).toBeNull()
    expect(isParserBijective(chatSearchParams.q, QUESTION_ID, QUESTION_ID)).toBe(true)
  })

  it('ref aceita período (AAAA-MM) e data (AAAA-MM-DD), ida e volta', () => {
    expect(isParserBijective(chatSearchParams.ref, '2024-03', { periodoApuracao: '2024-03' })).toBe(
      true,
    )
    expect(
      isParserBijective(chatSearchParams.ref, '2024-03-15', { referenceDate: '2024-03-15' }),
    ).toBe(true)
  })

  it('ref inválido vira null (a URL é entrada do usuário)', () => {
    expect(chatSearchParams.ref.parse('2024-13')).toBeNull()
    expect(chatSearchParams.ref.parse('ontem')).toBeNull()
  })

  it('ref compara pelo valor, não pela identidade do objeto', () => {
    expect(
      chatSearchParams.ref.eq({ periodoApuracao: '2024-03' }, { periodoApuracao: '2024-03' }),
    ).toBe(true)
    expect(
      chatSearchParams.ref.eq({ periodoApuracao: '2024-03' }, { referenceDate: '2024-03-01' }),
    ).toBe(false)
  })
})
