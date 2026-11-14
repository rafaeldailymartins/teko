import { fc, test } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import {
  checkCitations,
  citedIds,
  isInsufficient,
  leaksCanary,
  renderAnswerMarkdown,
  sanitizeAnswerMarkdown,
  toCitationLinks,
} from './answer-output.ts'

describe('isInsufficient', () => {
  it('reconhece a sentinela sozinha, com pontuação final ou em minúsculas', () => {
    expect(isInsufficient('INSUFICIENTE')).toBe(true)
    expect(isInsufficient('  insuficiente. ')).toBe(true)
    expect(isInsufficient('INSUFICIENTE!')).toBe(true)
    expect(isInsufficient('A informação é insuficiente para responder [S1].')).toBe(false)
  })
})

describe('citações', () => {
  it('lista os ids citados sem repetir, na ordem', () => {
    expect(citedIds('a [S2] b [S1] c [S2] [S10] [s3] [S0]')).toEqual(['S2', 'S1', 'S10'])
  })

  it('separa as válidas, remove as inexistentes e mantém o resto do texto', () => {
    expect(checkCitations('Vale 19% [S1] e [S99]. Ver [S2].', ['S1', 'S2', 'S3'])).toEqual({
      valid: ['S1', 'S2'],
      unknown: ['S99'],
      text: 'Vale 19% [S1] e . Ver [S2].',
    })
  })

  it('sem nenhuma válida, a lista de válidas vem vazia', () => {
    expect(checkCitations('Sem fonte.', ['S1']).valid).toEqual([])
  })

  it('vira link cite:, menos depois de !', () => {
    expect(toCitationLinks('Vale [S1].')).toBe('Vale [S1](cite:S1).')
    expect(toCitationLinks('![S1]')).toBe('![S1]')
  })

  it('renderAnswerMarkdown não deixa o link completar uma imagem', () => {
    expect(renderAnswerMarkdown('a ![[S1] b')).toBe('a  b')
    expect(renderAnswerMarkdown('<b>Vale</b> [S2].')).toBe('Vale [S2](cite:S2).')
  })
})

describe('sanitizeAnswerMarkdown', () => {
  it('remove HTML cru e imagens, mantém markdown e links', () => {
    expect(
      sanitizeAnswerMarkdown(
        'Veja <script>alert(1)</script> e ![x](https://evil.example/x.png), **negrito** [link](https://www.gov.br) e 1 < 2.',
      ),
    ).toBe('Veja alert(1) e , **negrito** [link](https://www.gov.br) e 1 < 2.')
  })

  it('remove tags com atributos e comentários', () => {
    expect(sanitizeAnswerMarkdown('<img src=x onerror=alert(1)><!-- c -->ok')).toBe('ok')
    expect(sanitizeAnswerMarkdown('<scr<b>ipt>x')).toBe('x')
    expect(sanitizeAnswerMarkdown('!![a](b)[c](d)')).toBe('')
  })

  const markup = fc.constantFrom('<', '>', 'a', '/', '!', '[', ']', '(', ')', ' ')

  test.prop([fc.string({ unit: markup, maxLength: 60 })])(
    'nunca sobra uma tag nem uma imagem',
    (text) => {
      const clean = sanitizeAnswerMarkdown(text)
      expect(clean).not.toMatch(/<\/?[A-Za-z!][^<>]*>/)
      expect(clean).not.toMatch(/!\[[^\]\n]*\]\([^)\n]*\)/)
    },
  )
})

describe('leaksCanary', () => {
  it('detecta o canário em qualquer parte', () => {
    expect(leaksCanary('…TEKO-CANARY-abc…', 'TEKO-CANARY-abc')).toBe(true)
    expect(leaksCanary('resposta normal', 'TEKO-CANARY-abc')).toBe(false)
  })
})
