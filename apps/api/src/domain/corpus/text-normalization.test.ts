import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { normalizeForHash } from './text-normalization.ts'

describe('normalizeForHash', () => {
  it('aplica NFC, tira invisíveis e controles e colapsa espaços', () => {
    expect(normalizeForHash('  Área​  de\t\ttexto \n\nfim\u0007 ')).toBe('Área de texto fim')
    expect(normalizeForHash('﻿x⁠y‌z‍')).toBe('xyz')
    expect(normalizeForHash('a\u0085b')).toBe('ab')
  })
})

const whitespaceArb = fc.constantFrom(' ', '  ', '\t', '\n', '\r\n', ' ')
const invisibleArb = fc.constantFrom('', '​', '﻿', '⁠')

describe('propriedades', () => {
  test.prop([
    fc.array(fc.stringMatching(/^[a-zçãé0-9§º.,]{1,8}$/), { minLength: 1, maxLength: 12 }),
    whitespaceArb,
    invisibleArb,
  ])('é invariante a whitespace e caracteres de largura zero', (words, separator, invisible) => {
    const plain = words.join(' ')
    const noisy = `${separator}${words.join(`${invisible}${separator}`)}${separator}`
    expect(normalizeForHash(noisy)).toBe(normalizeForHash(plain))
  })

  test.prop([fc.string()])('é idempotente e invariante a NFD/NFC', (text) => {
    const once = normalizeForHash(text)
    expect(normalizeForHash(once)).toBe(once)
    expect(normalizeForHash(text.normalize('NFD'))).toBe(normalizeForHash(text.normalize('NFC')))
  })
})
