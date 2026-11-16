import { isParserBijective } from 'nuqs/testing'
import { describe, expect, it } from 'vitest'
import {
  chatConversationHref,
  chatSearchParams,
  compareHref,
  compareSearchParams,
  newConversationHref,
  provisionHref,
  provisionSearchParams,
} from './url-state.ts'

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

describe('dispositivo e comparação', () => {
  const KEY = 'go:rcte:art:76:par:6'

  it('k aceita só chave estável no formato do shared', () => {
    expect(isParserBijective(provisionSearchParams.k, KEY, KEY)).toBe(true)
    expect(provisionSearchParams.k.parse('rcte:art-76')).toBeNull()
    expect(compareSearchParams.k.parse('go:rcte art 76')).toBeNull()
    expect(compareSearchParams.from.parse('2008-05')).toEqual({ periodoApuracao: '2008-05' })
  })

  it('links do chat, do dispositivo e da comparação', () => {
    expect(chatConversationHref('pt-BR', QUESTION_ID)).toBe(`/pt-BR/chat/?c=${QUESTION_ID}`)
    expect(newConversationHref('pt-BR', null)).toBe('/pt-BR/chat/')
    expect(newConversationHref('en', { periodoApuracao: '2008-05' })).toBe('/en/chat/?ref=2008-05')
    expect(provisionHref('en', KEY)).toBe(`/en/provision/?k=${KEY}`)
    expect(provisionHref('pt-BR', KEY, { referenceDate: '2008-05-01' })).toBe(
      `/pt-BR/provision/?k=${KEY}&ref=2008-05-01`,
    )
    expect(
      compareHref('pt-BR', KEY, { periodoApuracao: '2008-05' }, { periodoApuracao: '2010-01' }),
    ).toBe(`/pt-BR/compare/?k=${KEY}&from=2008-05&to=2010-01`)
    expect(compareHref('pt-BR', KEY, null, null)).toBe(`/pt-BR/compare/?k=${KEY}`)
  })
})
