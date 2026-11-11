import { test } from '@fast-check/vitest'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decodeHalfVector, encodeHalfVector, fromHalfBits, toHalfBits } from './half-float.ts'

describe('float16', () => {
  it.each([
    [0, 0x0000],
    [-0, 0x8000],
    [1, 0x3c00],
    [-2, 0xc000],
    [0.5, 0x3800],
    [65_504, 0x7bff],
    [2 ** -14, 0x0400],
    [2 ** -24, 0x0001],
  ])('%d ↔ 0x%s', (value, bits) => {
    expect(toHalfBits(value)).toBe(bits)
    expect(Object.is(fromHalfBits(bits), value)).toBe(true)
  })

  it('satura em infinito, zera abaixo do menor subnormal e preserva NaN', () => {
    expect(toHalfBits(1e6)).toBe(0x7c00)
    expect(toHalfBits(-1e6)).toBe(0xfc00)
    expect(toHalfBits(Number.POSITIVE_INFINITY)).toBe(0x7c00)
    expect(toHalfBits(1e-10)).toBe(0x0000)
    expect(toHalfBits(-1e-10)).toBe(0x8000)
    expect(fromHalfBits(0x7c00)).toBe(Number.POSITIVE_INFINITY)
    expect(fromHalfBits(0xfc00)).toBe(Number.NEGATIVE_INFINITY)
    expect(Number.isNaN(fromHalfBits(toHalfBits(Number.NaN)))).toBe(true)
  })

  it('arredonda para o par mais próximo, inclusive em subnormais e no transbordo da mantissa', () => {
    // 1 + 2^-11 fica exatamente no meio entre 1 e 1 + 2^-10: vai para o par (1).
    expect(toHalfBits(1 + 2 ** -11)).toBe(0x3c00)
    // 1 + 3 × 2^-11 fica no meio entre ímpar e par: sobe para o par.
    expect(toHalfBits(1 + 3 * 2 ** -11)).toBe(0x3c02)
    expect(toHalfBits(1 + 2 ** -11 + 2 ** -20)).toBe(0x3c01)
    // Subnormal no meio do caminho: 1,5 × 2^-24 vai para 2 × 2^-24 (par).
    expect(toHalfBits(1.5 * 2 ** -24)).toBe(0x0002)
    expect(toHalfBits(2.5 * 2 ** -24)).toBe(0x0002)
    expect(toHalfBits(2.75 * 2 ** -24)).toBe(0x0003)
    // 2047/1024 arredonda para 2 (a mantissa transborda para o expoente).
    expect(toHalfBits(2 - 2 ** -12)).toBe(0x4000)
  })

  it('codifica e decodifica vetores em base64 little-endian', () => {
    const encoded = encodeHalfVector([1, -2, 0.5])
    expect(Buffer.from(encoded, 'base64')).toEqual(
      Buffer.from([0x00, 0x3c, 0x00, 0xc0, 0x00, 0x38]),
    )
    expect(decodeHalfVector(encoded)).toEqual([1, -2, 0.5])
    expect(() => decodeHalfVector(Buffer.from([1, 2, 3]).toString('base64'))).toThrow(/ímpar/)
  })

  test.prop([fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { maxLength: 64 })])(
    'ida e volta dentro da precisão do binary16',
    (vector) => {
      const decoded = decodeHalfVector(encodeHalfVector(vector))
      expect(decoded).toHaveLength(vector.length)
      for (const [index, value] of vector.entries()) {
        // Erro relativo de 2^-11 nos normais; absoluto de 2^-25 nos subnormais.
        expect(Math.abs((decoded[index] ?? 0) - value)).toBeLessThanOrEqual(
          Math.max(Math.abs(value) * 2 ** -11, 2 ** -25),
        )
      }
    },
  )
})
