import { describe, expect, it } from 'vitest'
import { halfvecBase64Sql, halfvecTextFromBase64 } from './halfvec-wire.ts'

/** Binário do `halfvec_send`: dim, unused e os halves, big-endian, em base64. */
function send(halves: readonly number[], unused = 0, dimensions = halves.length): string {
  const buffer = Buffer.alloc(4 + 2 * halves.length)
  buffer.writeInt16BE(dimensions, 0)
  buffer.writeInt16BE(unused, 2)
  for (const [index, bits] of halves.entries()) {
    buffer.writeUInt16BE(bits, 4 + 2 * index)
  }
  return buffer.toString('base64')
}

const values = (text: string | null) => (text ?? '').slice(1, -1).split(',').map(Number)

describe('halfvec binário', () => {
  it('converte para o texto do halfvec_in com o valor exato de cada half', () => {
    // 0.5, -0.25, 1 + 1/1024, o menor subnormal (2^-24), zero e -0.
    const text = halfvecTextFromBase64(send([0x3800, 0xb400, 0x3c01, 0x0001, 0x0000, 0x8000]))
    expect(text).toBe('[0.5,-0.25,1.0009766,5.9604645e-8,0,-0]')
    expect(values(text).slice(0, 4)).toEqual([0.5, -0.25, 1.0009766, 5.9604645e-8])
    // A menor forma decimal volta ao mesmo float4 (e daí ao mesmo half).
    expect(Math.fround(1.0009766)).toBe(1 + 1 / 1024)
    expect(Math.fround(5.9604645e-8)).toBe(2 ** -24)
  })

  it('valor típico de embedding: menor decimal que volta ao float4 do half', () => {
    // 0x2bfe ≈ 0.06243896484375 (exato em half).
    const text = halfvecTextFromBase64(send([0x2bfe]))
    expect(text).toBe('[0.062438965]')
    expect(Math.fround(Number(values(text)[0]))).toBe(0.06243896484375)
  })

  it('null passa como null e binário inconsistente é erro', () => {
    expect(halfvecTextFromBase64(null)).toBeNull()
    expect(() => halfvecTextFromBase64('AA==')).toThrow(/sem cabeçalho/)
    expect(() => halfvecTextFromBase64(send([0x3800], 1))).toThrow(/inconsistente/)
    expect(() => halfvecTextFromBase64(send([0x3800], 0, 2))).toThrow(/inconsistente/)
    expect(() => halfvecTextFromBase64(send([0x7c00]))).toThrow(/NaN ou infinito/)
  })

  it('a expressão SQL lê o binário do halfvec_send em base64', () => {
    expect(halfvecBase64Sql('t.embedding')).toBe("encode(halfvec_send(t.embedding), 'base64')")
  })
})
